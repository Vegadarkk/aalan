import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Photos of refused and hidden listings against the Firebase emulators (audit C-3, owner decision
// 2026-11-04): the listing-photos job moves them from the public media bucket to the private one
// (removed/listings/...) and back once the listing is in public view again (real queries: uploads
// by target and bucket, the listing as stored), purge-quarantine's hidden scan (real query on
// moderation.hiddenBy.at behind its cursor) backs the hiding direction up, the owner view flags
// them, and the owner reads them through /api/owner-media while nobody else does.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })) }));

import { GET as ownerPhoto } from "@/app/api/owner-media/listings/[id]/[file]/route";
import { POST as create } from "@/app/api/listings/route";
import { GET as read, PATCH as patch } from "@/app/api/listings/[id]/route";
import { POST as publish } from "@/app/api/listings/[id]/publish/route";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import { getListing } from "@/lib/db/repositories/listings";
import { getUpload, readHiddenScanCursor, writeHiddenScanCursor } from "@/lib/db/repositories/uploads";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { MEDIA_CACHE_CONTROL, mediaObjectKey, retainedObjectKey } from "@/lib/media/urls";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { setObjectStoreForTests } from "@/lib/storage";
import { MemoryObjectStore } from "@/lib/storage/memory";
import { syncListingPhotos } from "@/worker/jobs/listing-photos";
import { purgeQuarantine, RETAINED_SCAN_LAG_MS } from "@/worker/jobs/purge-quarantine";
import { api, member, ORIGIN, readyPatch, seedReadyUpload, type ListingBody, type Member, type PublishBody } from "./helpers";

let owner: Member;
let stranger: Member;
const store = new MemoryObjectStore();
const VARIANTS = ["l", "s"] as const;

/** A published listing with one ready photo whose variants are in the media bucket. */
async function publishedListing(title: string): Promise<{ id: string; upload: string }> {
  const created = await api<CreateListingResponse>(create, "POST", "/api/listings", { member: owner, body: {} });
  const id = created.body.id;
  expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: readyPatch({ title }) })).status).toBe(200);
  const upload = await seedReadyUpload(owner, id);
  expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [upload] } })).status).toBe(200);
  expect((await api<PublishBody>(publish, "POST", `/api/listings/${id}/publish`, { member: owner, body: { acceptRules: true } })).body.status).toBe("published");
  for (const variant of VARIANTS) store.seed("media", mediaObjectKey(id, upload, variant), Buffer.from(`${upload}-${variant}`), { contentType: "image/webp" });
  return { id, upload };
}

async function hide(id: string, at: Date): Promise<void> {
  await db()
    .collection(COLLECTIONS.listings)
    .doc(id)
    .update({ "moderation.hiddenBy": { reportId: `decision-${id}`, signal: "decision", at: Timestamp.fromDate(at) }, updatedAt: Timestamp.fromDate(at) });
}

async function unhide(id: string): Promise<void> {
  await db().collection(COLLECTIONS.listings).doc(id).update({ "moderation.hiddenBy": FieldValue.delete(), updatedAt: Timestamp.now() });
}

function expectIn(bucket: "media" | "private", id: string, upload: string): void {
  for (const variant of VARIANTS) {
    expect(store.has("media", mediaObjectKey(id, upload, variant))).toBe(bucket === "media");
    expect(store.has("private", retainedObjectKey(id, upload, variant))).toBe(bucket === "private");
  }
}

async function getOwnerPhoto(path: string, who?: Member): Promise<Response> {
  const headers = new Headers({ host: "localhost:3000", "user-agent": "vitest", "x-forwarded-for": "10.77.0.3" });
  const cookie = who?.jar.header();
  if (cookie) headers.set("cookie", cookie);
  const [, , , , id, file] = path.split("/");
  return ownerPhoto(new NextRequest(`${ORIGIN}${path}`, { headers }), { params: Promise.resolve({ id, file }) });
}

beforeAll(async () => {
  resetServerEnv();
  resetRateLimiters();
  owner = await member({ displayName: "Karim Vendeur" });
  stranger = await member({ displayName: "Nadia Curieuse" });
  setObjectStoreForTests(store);
});

afterAll(() => {
  setObjectStoreForTests(undefined);
});

describe("photos of a hidden listing", () => {
  it("move to the private bucket, are served to their owner only, and come back to the media host once shown again", async () => {
    const { id, upload } = await publishedListing("Vélo de ville masqué puis rétabli");
    const kept = await publishedListing("Vélo de ville jamais masqué");
    await hide(id, new Date());

    expect(await syncListingPhotos(id, new Date(), { store })).toMatchObject({ action: "retain", retained: 1, failed: 0 });
    expectIn("private", id, upload);
    expect(await getUpload(upload)).toMatchObject({ status: "ready", bucket: "private", finalKey: `removed/listings/${id}/${upload}` });
    // A rerun moves nothing; a live listing's photos stay on the media host.
    const calls = store.calls.length;
    expect(await syncListingPhotos(id, new Date(), { store })).toMatchObject({ retained: 0, failed: 0 });
    expect(store.calls.slice(calls).filter((call) => call.op === "put" || call.op === "delete")).toEqual([]);
    expect(await syncListingPhotos(kept.id, new Date(), { store })).toMatchObject({ action: "release", released: 0 });
    expectIn("media", kept.id, kept.upload);

    // The owner view says so, and the owner route serves the private copy to the owner only.
    expect((await api<ListingBody>(read, "GET", `/api/listings/${id}`, { member: owner })).body.listing.privatePhotos).toBe(true);
    expect((await api<ListingBody>(read, "GET", `/api/listings/${kept.id}`, { member: owner })).body.listing.privatePhotos).toBeUndefined();
    const path = `/api/owner-media/listings/${id}/${upload}-s.webp`;
    const ok = await getOwnerPhoto(path, owner);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toBe("private, max-age=600");
    expect(Buffer.from(await ok.arrayBuffer()).toString()).toBe(`${upload}-s`);
    expect((await getOwnerPhoto(path, stranger)).status).toBe(404);
    expect((await getOwnerPhoto(path)).status).toBe(401);
    expect((await getOwnerPhoto(`/api/owner-media/listings/${id}/${upload}-x.webp`, owner)).status).toBe(404);

    // Shown again: back on the media host with the current cache policy, recorded on the upload.
    await unhide(id);
    const put = vi.spyOn(store, "put");
    expect(await syncListingPhotos(id, new Date(), { store })).toMatchObject({ action: "release", released: 1, failed: 0 });
    expectIn("media", id, upload);
    for (const variant of VARIANTS) expect(put).toHaveBeenCalledWith("media", mediaObjectKey(id, upload, variant), expect.anything(), { contentType: "image/webp", cacheControl: MEDIA_CACHE_CONTROL });
    put.mockRestore();
    expect(await getUpload(upload)).toMatchObject({ status: "ready", bucket: "media", finalKey: `listings/${id}/${upload}` });
    expect((await api<ListingBody>(read, "GET", `/api/listings/${id}`, { member: owner })).body.listing.privatePhotos).toBeUndefined();
  });

  it("leave the public bucket on the next purge-quarantine run when no job ran (hidden scan behind its cursor)", async () => {
    const { id, upload } = await publishedListing("Vélo de ville masqué sans file");
    const hiddenAt = new Date();
    await hide(id, hiddenAt);
    // The scan resumes just before this hide (hidden listings of other test files are older).
    await writeHiddenScanCursor({ at: new Date(hiddenAt.getTime() - 1), id });

    const early = await purgeQuarantine(new Date(hiddenAt.getTime() + RETAINED_SCAN_LAG_MS - 1_000), { store });
    expect(early.failed).toBe(0);
    expectIn("media", id, upload);
    const result = await purgeQuarantine(new Date(hiddenAt.getTime() + RETAINED_SCAN_LAG_MS + 1_000), { store });
    expect(result.failed).toBe(0);
    expect(result.retained).toBeGreaterThanOrEqual(1);
    expectIn("private", id, upload);
    expect((await readHiddenScanCursor())!.at.getTime()).toBeGreaterThanOrEqual(hiddenAt.getTime());
  });
});

describe("photos of a refused listing", () => {
  it("move to the private bucket and come back when the listing leaves `rejected`", async () => {
    const { id, upload } = await publishedListing("Vélo de ville refusé puis corrigé");
    await db().collection(COLLECTIONS.listings).doc(id).update({ status: "rejected", updatedAt: Timestamp.now() });
    expect((await getListing(id))!.status).toBe("rejected");

    expect(await syncListingPhotos(id, new Date(), { store })).toMatchObject({ action: "retain", retained: 1, failed: 0 });
    expectIn("private", id, upload);
    expect((await api<ListingBody>(read, "GET", `/api/listings/${id}`, { member: owner })).body.listing.privatePhotos).toBe(true);
    expect((await getOwnerPhoto(`/api/owner-media/listings/${id}/${upload}-l.webp`, owner)).status).toBe(200);

    // Resubmitted (pending review again): the photos return to the media host for the review and the page.
    await db().collection(COLLECTIONS.listings).doc(id).update({ status: "pending_review", updatedAt: Timestamp.now() });
    expect(await syncListingPhotos(id, new Date(), { store })).toMatchObject({ action: "release", released: 1, failed: 0 });
    expectIn("media", id, upload);
  });
});
