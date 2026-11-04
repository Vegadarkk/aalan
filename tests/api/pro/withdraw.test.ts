import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/admin/pros/{proId}/withdraw against the emulators (zone 7 audit P2-10, owner decision
// 2026-11-04 « Retour en vérification »): an admin withdraws a shop's validation; the shop goes back
// to a KYBC review with its plan kept, the Pro claims leave the account, the published listings
// are paused, the storefront is hidden, the Pro is mailed and the sign-in page names the reason;
// the new KYBC sent from the Pro space and validated restores the shop, its claims and listings.

vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })) }));

import { POST as postDecision } from "@/app/api/admin/pros/[proId]/route";
import { POST as postWithdraw } from "@/app/api/admin/pros/[proId]/withdraw/route";
import { POST as postModeration } from "@/app/api/admin/moderation/[id]/route";
import { POST as create } from "@/app/api/listings/route";
import { PATCH as patch } from "@/app/api/listings/[id]/route";
import { POST as publish } from "@/app/api/listings/[id]/publish/route";
import { GET as getMe } from "@/app/api/pro/me/route";
import { claimsChange } from "@/lib/auth/ended-session";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import type { ProDecisionResponse, ProMeResponse, ProWithdrawResponse } from "@/lib/contracts/pro";
import { getListing } from "@/lib/db/repositories/listings";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { getUserRecord } from "@/lib/db/repositories/profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { getClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import { sendMail } from "@/lib/mail";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { lastMail } from "../auth/helpers";
import { api, attachPhoto, freshPhone, member, readyPatch, seedReadyUpload, type ErrorBody, type ListingBody, type Member, type PublishBody } from "../listings/helpers";
import { admin, adminRequest, application, applyAs, code, kybPiece, staffAccount, type Staff } from "./helpers";

const me = (owner: Member) => api<ProMeResponse>(getMe, "GET", "/api/pro/me", { member: owner });

async function publishedListing(owner: Member): Promise<string> {
  const created = await api<CreateListingResponse>(create, "POST", "/api/listings", { member: owner, body: {} });
  const id = created.body.id;
  expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: readyPatch() })).status).toBe(200);
  const first = await seedReadyUpload(owner, id);
  expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [first] } })).status).toBe(200);
  await attachPhoto(id, await seedReadyUpload(owner, id));
  const result = await api<PublishBody>(publish, "POST", `/api/listings/${id}/publish`, { member: owner, body: { acceptRules: true } });
  expect(result.status).toBe(200);
  return id;
}

async function signInAgain(owner: Member): Promise<string> {
  const minted = await createSessionForUid(owner.uid);
  owner.jar.cookies.set("__Host-session", minted.cookie);
  owner.jar.cookies.set("__Host-csrf", csrfToken(minted.cookie));
  return minted.cookie;
}

async function auditActions(proId: string): Promise<string[]> {
  const audits = await db().collection(COLLECTIONS.auditLogs).where("target.id", "==", proId).get();
  return audits.docs.map((doc) => doc.get("action") as string);
}

/** A validated shop (launch offer) with one published listing, its owner signed in as a Pro. */
async function validatedShop(): Promise<{ owner: Member; proId: string; listingId: string }> {
  const owner = await member({ phone: freshPhone() });
  const proId = (await applyAs(owner, application([await kybPiece(owner)]))).body.proId;
  const submittedAt = (await getProProfile(proId))!.kybc.submittedAt!.toISOString();
  expect((await admin<ProDecisionResponse>(postDecision, "POST", `/api/admin/pros/${proId}`, moderator, { action: "verify", registrySource: "ompic", submittedAt })).status).toBe(200);
  await signInAgain(owner);
  const listingId = await publishedListing(owner);
  return { owner, proId, listingId };
}

const STATEMENT = "Le registre du commerce indique une radiation de la société.";
const NOTE = "Radiation vue sur l'OMPIC, à revérifier.";
const withdrawBody = { statement: STATEMENT, note: NOTE, lifecycle: "verified" };

let moderator: Staff;
let adminStaff: Staff;

beforeAll(async () => {
  resetServerEnv();
  moderator = await staffAccount("moderator");
  adminStaff = await staffAccount("admin");
});

beforeEach(() => {
  resetRateLimiters();
  vi.mocked(sendMail).mockClear();
});

describe("POST /api/admin/pros/{proId}/withdraw", () => {
  it("sends the shop back to a review, then its new KYBC validated restores everything", async () => {
    const { owner, proId, listingId } = await validatedShop();
    const path = `/api/admin/pros/${proId}/withdraw`;

    const withdrawn = await admin<ProWithdrawResponse>(postWithdraw, "POST", path, adminStaff, withdrawBody);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body).toEqual({ proId, lifecycle: "revalidation_required", paused: 1 });

    // The shop: under review, plan kept, the statement and the note recorded.
    const profile = await getProProfile(proId);
    expect(profile).toMatchObject({ lifecycle: "revalidation_required", revalidationFrom: "verified", plan: "essentiel", planSource: "launch_offer", kybc: { status: "withdrawn", withdrawReason: STATEMENT } });
    expect(profile?.staffNotes?.[0]?.text).toContain(NOTE);
    expect(profile?.purgeAt).toBeUndefined();
    // The account: kept, Pro type (it publishes nothing as an individual meanwhile), Pro claims gone.
    expect(await getUserRecord(owner.uid)).toMatchObject({ status: "active", type: "pro", proId });
    const claims = await getClaims(owner.uid);
    expect(claims.role).toBe("individual");
    expect(claims.proId).toBeUndefined();
    // The listing: paused for the revalidation, not deleted.
    expect(await getListing(listingId)).toMatchObject({ status: "paused", pausedReason: "pro_revalidation", sellerType: "pro", proId });
    // The trace, the mail and the sign-in page's reason.
    expect(await auditActions(proId)).toContain("pro.validation.withdraw");
    expect(lastMail(sendMail, "proValidationWithdrawn", owner.email)?.data).toMatchObject({ shopName: "Atlas Vélos", reason: STATEMENT });
    // What the sign-in page compares (the Auth emulator checks revocation on every cookie read, so
    // the cookie's own claims are those the session was signed with: the Pro ones).
    expect(claimsChange({ role: "pro", proId, proRole: "owner" }, await getClaims(owner.uid))).toEqual({ kind: "pro-withdrawn" });

    // The Pro space: hidden storefront, the statement, and the way back.
    await signInAgain(owner);
    const space = await me(owner);
    expect(space.body.shop).toMatchObject({ lifecycle: "revalidation_required", kybcStatus: "withdrawn", withdrawReason: STATEMENT, storefront: null, plan: "essentiel" });
    const again = await admin<ErrorBody>(postWithdraw, "POST", path, adminStaff, withdrawBody);
    expect(again.status).toBe(409);

    // The new KYBC: the shop's settings kept, back in the queue.
    const resent = await applyAs(owner, application([await kybPiece(owner)], { name: "Atlas Vélos SARL" }));
    expect(resent.status).toBe(201);
    expect(resent.body.proId).toBe(proId);
    const review = await getProProfile(proId);
    expect(review).toMatchObject({ lifecycle: "revalidation_required", revalidationFrom: "verified", plan: "essentiel", name: "Atlas Vélos SARL", kybc: { status: "submitted", withdrawReason: STATEMENT } });
    expect((await me(owner)).body.shop).toMatchObject({ lifecycle: "revalidation_required", kybcStatus: "submitted" });
    const twice = await applyAs(owner, application([await kybPiece(owner)]));
    expect(code(twice.body)).toBe("pro_application_exists");

    // The review validates it again: state, plan, claims and the listing come back.
    const decided = await admin<ProDecisionResponse>(postDecision, "POST", `/api/admin/pros/${proId}`, moderator, { action: "verify", registrySource: "ompic", submittedAt: review!.kybc.submittedAt!.toISOString() });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ lifecycle: "verified", effectsPending: false });
    const restored = await getProProfile(proId);
    expect(restored).toMatchObject({ lifecycle: "verified", plan: "essentiel", planSource: "launch_offer", kybc: { status: "verified" } });
    expect(restored?.revalidationFrom).toBeUndefined();
    expect(restored?.kybc.withdrawReason).toBeUndefined();
    expect(await getClaims(owner.uid)).toMatchObject({ role: "pro", proId, proRole: "owner" });
    expect(await getListing(listingId)).toMatchObject({ status: "published", sellerType: "pro", proId });
    expect((await getListing(listingId))?.pausedReason).toBeUndefined();
    expect(lastMail(sendMail, "proApproved", owner.email)?.data).toMatchObject({ shopName: "Atlas Vélos SARL", launchOffer: true });
    await signInAgain(owner);
    expect((await me(owner)).body.shop?.storefront).toBe(`${restored!.slug}-${proId}`);
  });

  it("keeps a Pro listing still held for review offline: the queue cannot approve it until the new validation", async () => {
    const { proId, listingId } = await validatedShop();
    // Held at the time of the withdrawal (the screening sent it to the queue).
    await db().collection(COLLECTIONS.listings).doc(listingId).update({ status: "pending_review" });
    expect((await admin<ProWithdrawResponse>(postWithdraw, "POST", `/api/admin/pros/${proId}/withdraw`, adminStaff, withdrawBody)).status).toBe(200);
    const held = await getListing(listingId);
    expect(held?.status).toBe("pending_review");
    const response = await adminRequest(postModeration, "POST", `/api/admin/moderation/${listingId}`, moderator, { action: "approve", version: held!.version }, { params: { id: listingId } });
    expect(response.status).toBe(409);
    expect(code(await response.json())).toBe("pro_revalidation");
    expect((await getListing(listingId))?.status).toBe("pending_review");
  });

  it("keeps a refused resubmission hidden, without a purge date, and lets the Pro send another", async () => {
    const { owner, proId } = await validatedShop();
    expect((await admin(postWithdraw, "POST", `/api/admin/pros/${proId}/withdraw`, adminStaff, withdrawBody)).status).toBe(200);
    await signInAgain(owner);
    expect((await applyAs(owner, application([await kybPiece(owner)]))).status).toBe(201);
    const submittedAt = (await getProProfile(proId))!.kybc.submittedAt!.toISOString();
    const reason = "Le nouvel extrait du registre est illisible.";
    expect((await admin(postDecision, "POST", `/api/admin/pros/${proId}`, moderator, { action: "reject", reason, submittedAt })).status).toBe(200);
    const profile = await getProProfile(proId);
    expect(profile).toMatchObject({ lifecycle: "revalidation_required", plan: "essentiel", kybc: { status: "rejected", rejectReason: reason } });
    expect(profile?.purgeAt).toBeUndefined();
    expect(lastMail(sendMail, "proRejected", owner.email)?.data).toMatchObject({ reason, revalidation: true });
    expect((await applyAs(owner, application([await kybPiece(owner)]))).status).toBe(201);
  });

  it("is for admins only, and refuses a stale state or a shop that is not validated", async () => {
    const { proId } = await validatedShop();
    const path = `/api/admin/pros/${proId}/withdraw`;
    const byModerator = await admin<ErrorBody>(postWithdraw, "POST", path, moderator, withdrawBody);
    expect(byModerator.status).toBe(403);
    const someone = await member();
    const byMember = await api<ErrorBody>(postWithdraw, "POST", path, { member: someone, body: withdrawBody, params: { proId } });
    expect([401, 403, 404]).toContain(byMember.status);
    const stale = await admin<ErrorBody>(postWithdraw, "POST", path, adminStaff, { ...withdrawBody, lifecycle: "active" });
    expect(stale.status).toBe(409);
    expect((await admin(postWithdraw, "POST", path, adminStaff, { ...withdrawBody, statement: "Trop court" })).status).toBe(400);
    expect((await getProProfile(proId))?.lifecycle).toBe("verified");

    const applicant = await member({ phone: freshPhone() });
    const pendingId = (await applyAs(applicant, application([await kybPiece(applicant)]))).body.proId;
    expect((await admin(postWithdraw, "POST", `/api/admin/pros/${pendingId}/withdraw`, adminStaff, withdrawBody)).status).toBe(409);
    expect((await getClaims(applicant.uid)).role).toBe("individual");
  });
});
