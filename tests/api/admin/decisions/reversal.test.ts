import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Reversal on appeal against the owner's current state (Firebase emulators): only what the reversed
// decision removed comes back, and only as far as the account allows. A closed account stays
// closed and its listings offline; a listing its owner deleted stays deleted; a suspension that
// still runs keeps the account suspended (record, status, claim, listings paused) when another one
// or a ban is reversed; a listing held for review goes back to the review queue, never online.

import type * as Turnstile from "@/lib/security/turnstile";

vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof Turnstile>()),
  verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })),
}));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));
vi.mock("@/lib/rate-limit/limiter", { spy: true });

import { POST as reviewRoute } from "@/app/api/admin/appeals/[decisionId]/route";
import { POST as decideRoute } from "@/app/api/admin/decisions/route";
import { POST as linkRoute } from "@/app/api/appeals/link/route";
import { POST as appealRoute } from "@/app/api/appeals/route";
import { POST as pauseRoute } from "@/app/api/listings/[id]/pause/route";
import { DELETE as deleteRoute } from "@/app/api/listings/[id]/route";
import { POST as soldRoute } from "@/app/api/listings/[id]/sold/route";
import { closeAccount } from "@/lib/account/close";
import type { DecideResponse, OpenAppealResponse, ReviewAppealResponse } from "@/lib/decisions/contracts";
import { setDecisionAiHooks } from "@/lib/decisions/hooks";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { auth, db } from "@/lib/firebase/admin";
import { getClaims } from "@/lib/firebase/claims";
import { sendMail } from "@/lib/mail";
import { setEventPublisherForTests } from "@/lib/messaging/events";
import { setMessagingValkeyForTests } from "@/lib/messaging/unread";
import * as limiter from "@/lib/rate-limit/limiter";
import { liftSuspensions } from "@/worker/jobs/lift-suspensions";
import { FakeValkey } from "../../../unit/messaging-fake-valkey";
import { api } from "../../listings/helpers";
import { publishedListing } from "../../reports/helpers";
import { adminCall, listing, mailTo, publicCall, resignIn, staff, userStatus, type Member, type Staff } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
let moderator: Staff;
let reviewer: Staff;
let adminStaff: Staff;

beforeAll(async () => {
  resetServerEnv();
  setDecisionAiHooks({ requestAppealReview: async () => undefined, markAiDecision: async () => undefined, appealProposal: async () => null });
  setMessagingValkeyForTests(new FakeValkey().asClient());
  setEventPublisherForTests(async () => undefined);
  moderator = await staff("moderator");
  reviewer = await staff("moderator");
  adminStaff = await staff("admin");
});

afterAll(() => {
  setMessagingValkeyForTests(undefined);
  setEventPublisherForTests(undefined);
});

beforeEach(() => {
  limiter.resetRateLimiters();
  vi.mocked(sendMail).mockClear();
});

async function decide(as: Staff, body: Record<string, unknown>): Promise<string> {
  const decided = await adminCall<DecideResponse>(decideRoute, "POST", "/api/admin/decisions", { as, body });
  expect(decided.status).toBe(201);
  return decided.body.decisionId;
}

async function appealAsOwner(who: Member, decisionId: string): Promise<void> {
  const appeal = await publicCall<OpenAppealResponse>(appealRoute, "POST", "/api/appeals", { as: who, body: { decisionId, text: "Je conteste cette décision, voici pourquoi." } });
  expect(appeal.status).toBe(201);
}

async function appealByLink(who: Member, decisionId: string): Promise<void> {
  const notice = mailTo(sendMail, "decisionNotice", who.email);
  expect(notice?.data.decisionId).toBe(decisionId);
  const appeal = await publicCall<OpenAppealResponse>(linkRoute, "POST", "/api/appeals/link", { body: { token: notice?.data.appealToken, text: "Je conteste ce bannissement." } });
  expect(appeal.status).toBe(201);
}

async function reverse(decisionId: string): Promise<void> {
  const reviewed = await adminCall<ReviewAppealResponse>(reviewRoute, "POST", `/api/admin/appeals/${decisionId}`, {
    as: reviewer,
    params: { decisionId },
    body: { outcome: "reversed", note: "La décision n'était pas fondée." },
  });
  expect(reviewed.status).toBe(200);
}

async function suspensionDoc(uid: string): Promise<Record<string, unknown> | undefined> {
  return (await db().collection(COLLECTIONS.suspensions).doc(uid).get()).data();
}

describe("reversal against the owner's state", () => {
  it("leaves the listings of an account closed meanwhile offline, and the account closed", async () => {
    const { id, seller } = await publishedListing();
    const removalId = await decide(moderator, { target: `listing:${id}`, templateId: "listing.remove.scam" });
    await appealAsOwner(seller, removalId);
    await closeAccount(seller.uid);
    expect(await userStatus(seller.uid)).toBe("closed");

    await reverse(removalId);
    expect(await listing(id)).toMatchObject({ status: "removed" });
    expect(await userStatus(seller.uid)).toBe("closed");
    expect((await auth().getUser(seller.uid)).disabled).toBe(true);
  });

  it("does not republish a restricted listing its owner deleted", async () => {
    const { id, seller } = await publishedListing();
    const restrictionId = await decide(moderator, { target: `listing:${id}`, templateId: "listing.restrict", details: "Photos sans rapport avec l'objet." });
    await appealAsOwner(seller, restrictionId);
    expect((await api(deleteRoute, "DELETE", `/api/listings/${id}`, { member: seller })).status).toBe(204);

    await reverse(restrictionId);
    const after = await listing(id);
    expect(after.status).toBe("removed");
    expect(after.moderation.hiddenBy).toBeUndefined();
  });

  it("brings a removed listing back paused while another decision keeps the owner suspended; the lift publishes it", async () => {
    const { id, seller } = await publishedListing();
    const removalId = await decide(moderator, { target: `listing:${id}`, templateId: "listing.remove.misleading" });
    await appealAsOwner(seller, removalId);
    await decide(moderator, { target: `user:${seller.uid}`, templateId: "user.suspend.7" });
    expect(await userStatus(seller.uid)).toBe("suspended");

    await reverse(removalId);
    expect(await listing(id)).toMatchObject({ status: "paused", pausedReason: "moderation" });

    expect((await liftSuspensions(new Date(Date.now() + 8 * DAY_MS))).failed).toBe(0);
    expect(await userStatus(seller.uid)).toBe("active");
    expect(await listing(id)).toMatchObject({ status: "published" });
  });
});

describe("standing suspensions", () => {
  it("reversing one suspension keeps the other one running: record, status, claim and paused listings", async () => {
    const { id, seller } = await publishedListing();
    const longId = await decide(moderator, { target: `user:${seller.uid}`, templateId: "user.suspend.30" });
    const shortId = await decide(moderator, { target: `user:${seller.uid}`, templateId: "user.suspend.7" });
    expect((await suspensionDoc(seller.uid))?.["decisionId"]).toBe(shortId);
    await appealAsOwner(await resignIn(seller), shortId);

    await reverse(shortId);
    expect(await userStatus(seller.uid)).toBe("suspended");
    expect((await getClaims(seller.uid)).st).toBe("suspended");
    const record = await suspensionDoc(seller.uid);
    expect(record?.["decisionId"]).toBe(longId);
    const until = (record?.["until"] as { toDate(): Date }).toDate().getTime();
    expect(until).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect(await listing(id)).toMatchObject({ status: "paused", pausedReason: "moderation" });
  });

  it("a ban reversed while an earlier suspension still runs leaves the account suspended, listings paused", async () => {
    const { id, seller } = await publishedListing();
    const suspensionId = await decide(moderator, { target: `user:${seller.uid}`, templateId: "user.suspend.30" });
    vi.mocked(sendMail).mockClear();
    const banId = await decide(adminStaff, { target: `user:${seller.uid}`, templateId: "user.ban" });
    expect(await listing(id)).toMatchObject({ status: "removed" });
    await appealByLink(seller, banId);

    await reverse(banId);
    expect((await auth().getUser(seller.uid)).disabled).toBe(false);
    expect(await userStatus(seller.uid)).toBe("suspended");
    expect((await getClaims(seller.uid)).st).toBe("suspended");
    expect((await suspensionDoc(seller.uid))?.["decisionId"]).toBe(suspensionId);
    expect(await listing(id)).toMatchObject({ status: "paused", pausedReason: "moderation" });
  });

  it("a ban reversed with no suspension left gives an active account without the suspended claim", async () => {
    const { id, seller } = await publishedListing();
    const suspensionId = await decide(moderator, { target: `user:${seller.uid}`, templateId: "user.suspend.7" });
    await appealAsOwner(await resignIn(seller), suspensionId);
    await reverse(suspensionId);
    expect(await userStatus(seller.uid)).toBe("active");
    vi.mocked(sendMail).mockClear();
    const banId = await decide(adminStaff, { target: `user:${seller.uid}`, templateId: "user.ban" });
    await appealByLink(seller, banId);

    await reverse(banId);
    expect(await userStatus(seller.uid)).toBe("active");
    expect((await getClaims(seller.uid)).st).toBeUndefined();
    expect(await suspensionDoc(seller.uid)).toBeUndefined();
    expect(await listing(id)).toMatchObject({ status: "published" });
  });
});

describe("held listings", () => {
  it("a listing held for review when the ban came goes back to the review queue, not online", async () => {
    const { id, seller } = await publishedListing();
    await db().collection(COLLECTIONS.listings).doc(id).update({ "moderation.state": "needs_review" });
    const banId = await decide(adminStaff, { target: `user:${seller.uid}`, templateId: "user.ban" });
    expect(await listing(id)).toMatchObject({ status: "removed" });
    await appealByLink(seller, banId);

    await reverse(banId);
    expect(await userStatus(seller.uid)).toBe("active");
    expect(await listing(id)).toMatchObject({ status: "pending_review" });
  });
});

describe("what the removal replaced", () => {
  it("a ban reversal gives back the owner's own pause, and a removal reversal gives back a sale", async () => {
    const { id, seller } = await publishedListing();
    const sold = await publishedListing({ seller });
    expect((await api(pauseRoute, "POST", `/api/listings/${id}/pause`, { member: seller, body: {} })).status).toBe(200);
    expect((await api(soldRoute, "POST", `/api/listings/${sold.id}/sold`, { member: seller, body: {} })).status).toBe(200);

    const removalId = await decide(moderator, { target: `listing:${sold.id}`, templateId: "listing.remove.misleading" });
    expect((await listing(sold.id)).moderation.removedFrom).toEqual({ status: "sold" });
    await appealAsOwner(seller, removalId);
    await reverse(removalId);
    const back = await listing(sold.id);
    expect(back.status).toBe("sold");
    expect(back.moderation.removedFrom).toBeUndefined();

    vi.mocked(sendMail).mockClear();
    const banId = await decide(adminStaff, { target: `user:${seller.uid}`, templateId: "user.ban" });
    expect((await listing(id)).moderation.removedFrom).toEqual({ status: "paused", pausedReason: "owner" });
    await appealByLink(seller, banId);
    await reverse(banId);
    expect(await listing(id)).toMatchObject({ status: "paused", pausedReason: "owner" });
  });
});
