import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Near-duplicate photos against the emulator (audit zone 7 P4 "Photo en double"): the repository
// keeps `photoKeys` in step with `photos`, the owner's near-duplicate raises dup_photo, another
// account's raises dup_photo_other through the band-key query, a flat test photo raises nothing.

vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof Turnstile>()),
  verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })),
}));

import { POST as create } from "@/app/api/listings/route";
import { PATCH as patch } from "@/app/api/listings/[id]/route";
import { POST as publish } from "@/app/api/listings/[id]/publish/route";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import { attachReadyPhoto, listingRef, removePhoto } from "@/lib/db/repositories/listings";
import { resetServerEnv } from "@/lib/env";
import { moderationReview } from "@/lib/listings/moderation-actions";
import { photoKeys } from "@/lib/media/near-duplicate";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import type * as Turnstile from "@/lib/security/turnstile";
import { api, member, readyPatch, seedReadyUpload, type ListingBody, type Member, type PublishBody } from "./helpers";

beforeAll(() => resetServerEnv());
beforeEach(() => resetRateLimiters());

/** A random informative hash of this run (no other test file shares it). */
function randomHash(): string {
  for (;;) {
    const hash = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    if (photoKeys(hash).length === 4) return hash;
  }
}

/** `hash` with its lowest `bits` bits flipped (a re-encoded copy: a few bits move). */
const flip = (hash: string, bits: number) => (BigInt(`0x${hash}`) ^ ((1n << BigInt(bits)) - 1n)).toString(16).padStart(16, "0");

async function listingWithPhoto(owner: Member, hash: string, title: string): Promise<string> {
  const id = (await api<CreateListingResponse>(create, "POST", "/api/listings", { member: owner, body: {} })).body.id;
  expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: readyPatch({ title }) })).status).toBe(200);
  const upload = await seedReadyUpload(owner, id, { hash });
  expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [upload] } })).status).toBe(200);
  return id;
}

async function published(owner: Member, hash: string, title: string): Promise<{ id: string; body: PublishBody }> {
  const id = await listingWithPhoto(owner, hash, title);
  const result = await api<PublishBody>(publish, "POST", `/api/listings/${id}/publish`, { member: owner, body: { acceptRules: true } });
  expect(result.status).toBe(200);
  return { id, body: result.body };
}

const storedKeys = async (id: string) => ((await listingRef(id).get()).data()?.photoKeys as string[] | undefined) ?? [];

describe("near-duplicate photos", () => {
  it("keeps photoKeys in step with the photos (PATCH, pipeline attach, removal)", async () => {
    const owner = await member();
    const hash = randomHash();
    const id = await listingWithPhoto(owner, hash, "Table basse en chêne massif");
    expect(await storedKeys(id)).toEqual(photoKeys(hash));
    const second = randomHash();
    const upload = await seedReadyUpload(owner, id, { hash: second });
    // The pipeline's attach, with the hash it computed.
    await attachReadyPhoto(id, { id: upload, w: 1600, h: 1200, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj", hash: second }, { maxPhotos: 10 });
    expect(await storedKeys(id)).toEqual([...photoKeys(hash), ...photoKeys(second)]);
    const first = (await listingRef(id).get()).data()?.photos[0].id as string;
    await removePhoto(id, first);
    expect(await storedKeys(id)).toEqual(photoKeys(second));
  });

  it("flags a near-duplicate of the owner's photo as dup_photo, of another account's as dup_photo_other", async () => {
    const seller = await member();
    const copier = await member();
    const hash = randomHash();
    const original = await published(seller, hash, "Canapé d'angle en cuir marron");
    expect(original.body.flags).toEqual([]);

    // The same seller re-posts a re-encoded copy (3 bits off): their own duplicate.
    const repost = await published(seller, flip(hash, 3), "Canapé d'angle cuir, très bon état");
    expect(repost.body.flags).toEqual(["dup_photo"]);

    // Another account shows a copy 2 bits off the original: found through the band keys.
    const copy = await published(copier, flip(hash, 2), "Canapé cuir marron à saisir");
    expect(copy.body.flags).toEqual(["dup_photo_other"]);
    const review = await moderationReview(copy.id);
    const line = review?.screening?.evidence.find((item) => item.startsWith("same photo as"));
    expect(line).toMatch(/^same photo as 2 listing\(s\) of other accounts: /);
    expect(line).toContain(original.id);
    expect(line).toContain(repost.id);
  });

  it("raises nothing for flat test photos, identical or not", async () => {
    const owner = await member();
    const other = await member();
    await published(owner, "0000000000000000", "Lampe de bureau articulée noire");
    expect((await published(owner, "0000000000000000", "Lampe de chevet en laiton")).body.flags).toEqual([]);
    expect((await published(other, "0000000000000001", "Lampe à poser en céramique")).body.flags).toEqual([]);
  });
});

