import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as AgentQueue from "@/lib/ai/queue";

// The listings producers of the agent queue (design D19, D20; audit D1b-01) against the
// emulators, the queue mocked: a publication (published or held) and a screened renewal enqueue
// `listing_screen` with the committed version, a renewal of content a moderator approved does
// not, and a queue failure never fails the publication. A screened edit of a live or held listing
// and a resume are screened too (audit C-1); a listing under review keeps its content (audit C-2).

vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/queue", async (importOriginal) => ({ ...(await importOriginal<typeof AgentQueue>()), enqueueAiTask: vi.fn(async () => ({ queued: true })) }));

import { POST as create } from "@/app/api/listings/route";
import { PATCH as patch } from "@/app/api/listings/[id]/route";
import { POST as pause } from "@/app/api/listings/[id]/pause/route";
import { POST as publish } from "@/app/api/listings/[id]/publish/route";
import { POST as renew } from "@/app/api/listings/[id]/renew/route";
import { POST as resume } from "@/app/api/listings/[id]/resume/route";
import { enqueueAiTask } from "@/lib/ai/queue";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import { getListing, updateListing } from "@/lib/db/repositories/listings";
import { resetServerEnv } from "@/lib/env";
import { DAY_MS, api, member, readyPatch, seedReadyUpload, type ErrorBody, type ListingBody, type Member, type PublishBody } from "../listings/helpers";
import { publishedListing } from "../reports/helpers";

const enqueueMock = vi.mocked(enqueueAiTask);
const SOFT_TITLE = "Réplique de vélo de course vintage";

beforeAll(() => resetServerEnv());
beforeEach(() => enqueueMock.mockClear());

/** A complete draft with one ready photo, title overridable (a "réplique" is a soft flag: held). */
async function readyDraft(owner: Member, title?: string): Promise<string> {
  const created = await api<CreateListingResponse>(create, "POST", "/api/listings", { member: owner, body: {} });
  expect(created.status).toBe(201);
  const id = created.body.id;
  const uploadId = await seedReadyUpload(owner, id);
  const saved = await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { ...readyPatch(title ? { title } : {}), photos: [uploadId] } });
  expect(saved.status).toBe(200);
  return id;
}

/** The expiry job has run: expired a day ago, purge in a year (the job's own patch). */
async function expire(id: string): Promise<void> {
  const now = Date.now();
  await updateListing(id, { status: "expired", expiresAt: new Date(now - DAY_MS), purgeAt: new Date(now + 365 * DAY_MS) });
}

const screening = (id: string, version: number) => ["listing_screen", { type: "listing", id }, { version }] as const;

describe("listing_screen producers", () => {
  it("queues a screening of a published listing under its committed version", async () => {
    const { id } = await publishedListing();
    const stored = (await getListing(id))!;
    expect(stored.status).toBe("published");
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(...screening(id, stored.version));
  });

  it("queues a screening of a held listing too (the agent may approve it alone)", async () => {
    const owner = await member();
    const id = await readyDraft(owner, SOFT_TITLE);
    const held = await api<PublishBody>(publish, "POST", `/api/listings/${id}/publish`, { member: owner, body: { acceptRules: true } });
    expect(held.body.status).toBe("pending_review");
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(...screening(id, (await getListing(id))!.version));
  });

  it("never fails a publication because the queue is down", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("agent job not enqueued in time"));
    const owner = await member();
    const id = await readyDraft(owner);
    const result = await api<PublishBody & ErrorBody>(publish, "POST", `/api/listings/${id}/publish`, { member: owner, body: { acceptRules: true } });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("published");
    expect(enqueueMock).toHaveBeenCalledOnce();
  });

  it("queues a screening of a renewed expired listing under its new version", async () => {
    const { id, seller } = await publishedListing();
    await expire(id);
    const before = (await getListing(id))!;
    enqueueMock.mockClear();
    const renewed = await api<ListingBody & ErrorBody>(renew, "POST", `/api/listings/${id}/renew`, { member: seller });
    expect(renewed.status).toBe(200);
    expect(renewed.body.listing.status).toBe("published");
    const after = (await getListing(id))!;
    expect(after.version).toBeGreaterThan(before.version);
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(...screening(id, after.version));
  });

  it("does not screen again content a moderator approved and unchanged since", async () => {
    const { id, seller } = await publishedListing();
    await expire(id);
    const current = (await getListing(id))!;
    await updateListing(id, { moderation: { ...current.moderation, state: "human_ok", reviewedBy: "moderator-1", reviewedAt: new Date() } });
    enqueueMock.mockClear();
    const renewed = await api<ListingBody & ErrorBody>(renew, "POST", `/api/listings/${id}/renew`, { member: seller });
    expect(renewed.status).toBe(200);
    expect(renewed.body.listing.status).toBe("published");
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("screened edits (audit C-1)", () => {
  it("queues a screening of a published listing's screened edit under its new version", async () => {
    const { id, seller } = await publishedListing();
    enqueueMock.mockClear();
    const saved = await api<ListingBody & ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: seller, body: { description: "Vélo en très bon état, pneus neufs, révisé le mois dernier chez un professionnel." } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.listing.status).toBe("published");
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(...screening(id, (await getListing(id))!.version));
  });

  it("queues a screening of a held edit too (the agent may approve it alone)", async () => {
    const { id, seller } = await publishedListing();
    enqueueMock.mockClear();
    const saved = await api<ListingBody & ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: seller, body: { title: SOFT_TITLE } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.listing.status).toBe("pending_review");
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(...screening(id, (await getListing(id))!.version));
  });

  it("does not queue an edit the screens do not read, nor a paused listing's edit before its resume", async () => {
    const { id, seller } = await publishedListing();
    expect((await api(pause, "POST", `/api/listings/${id}/pause`, { member: seller })).status).toBe(200);
    enqueueMock.mockClear();
    const saved = await api<ListingBody & ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: seller, body: { description: "Vélo en très bon état, pneus neufs, révisé le mois dernier chez un professionnel." } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.listing.status).toBe("paused");
    expect(enqueueMock).not.toHaveBeenCalled();
    // Back online: screened under the resumed version (the agent skips content it already saw).
    expect((await api(resume, "POST", `/api/listings/${id}/resume`, { member: seller })).status).toBe(200);
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(...screening(id, (await getListing(id))!.version));
  });

  it("does not screen the resume of content a moderator approved and unchanged since", async () => {
    const { id, seller } = await publishedListing();
    expect((await api(pause, "POST", `/api/listings/${id}/pause`, { member: seller })).status).toBe(200);
    const current = (await getListing(id))!;
    await updateListing(id, { moderation: { ...current.moderation, state: "human_ok", reviewedBy: "moderator-1", reviewedAt: new Date() } });
    enqueueMock.mockClear();
    expect((await api(resume, "POST", `/api/listings/${id}/resume`, { member: seller })).status).toBe(200);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("listings under review (audit C-2)", () => {
  it("refuses a screened edit while a legal hold or an open report is on the listing (409), keeps other saves", async () => {
    const { id, seller } = await publishedListing();
    const before = (await getListing(id))!;
    await updateListing(id, { legalHold: ["report:r-held-1"], moderation: { ...before.moderation, openReports: 1 } });
    enqueueMock.mockClear();
    const refused = await api<ListingBody & ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: seller, body: { title: "Vélo de ville tout neuf" } });
    expect([refused.status, refused.body.error.code]).toEqual([409, "listing_under_review"]);
    const stored = (await getListing(id))!;
    expect(stored.title).toBe(before.title);
    expect(stored.version).toBe(before.version + 1);
    expect(enqueueMock).not.toHaveBeenCalled();

    // An authority hold alone (no open report) freezes the content as well.
    await updateListing(id, { legalHold: ["authority:a-1"], moderation: { ...stored.moderation, openReports: 0 } });
    const authority = await api<ListingBody & ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: seller, body: { description: "Nouvelle description sans rapport avec la précédente, pour effacer le texte signalé." } });
    expect([authority.status, authority.body.error.code]).toEqual([409, "listing_under_review"]);

    // The decision lifts the holds: the seller edits again.
    await updateListing(id, { legalHold: [] });
    const saved = await api<ListingBody & ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: seller, body: { title: "Vélo de ville tout neuf" } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await getListing(id))!.title).toBe("Vélo de ville tout neuf");
  });
});
