import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A draft save racing the photo pipeline (zone 3 audit P3-13, two 409 on the Photos step): the
// pipeline attaches each photo to a draft in its own transaction (version + 1). The save of the
// photo order reads the draft, reads the fresh uploads, then commits on the version it read; a photo
// attached in between made it a 409. The server now reads the draft again and redoes the save; a
// live listing keeps the 409 (its save is screened again, a report must not be written over).

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
// Runs `race.during` while the save reads its fresh uploads (`race.fresh`, the ids the listing does
// not hold yet): the moment the pipeline lands in. `race.tries` counts those reads, one per try.
const race = vi.hoisted(() => ({ during: null as null | (() => Promise<void>), fresh: "", times: 0, tries: 0 }));
vi.mock("@/lib/db/repositories/uploads", async (importOriginal) => {
  const actual = await importOriginal<typeof UploadsRepo>();
  return {
    ...actual,
    getUploads: vi.fn(async (ids: readonly string[]) => {
      if (ids.includes(race.fresh)) {
        race.tries += 1;
        if (race.during && race.times > 0) {
          race.times -= 1;
          await race.during();
        }
      }
      return actual.getUploads(ids);
    }),
  };
});

import { PATCH as patch } from "@/app/api/listings/[id]/route";
import { POST as create } from "@/app/api/listings/route";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import { getListing, updateListing } from "@/lib/db/repositories/listings";
import type * as UploadsRepo from "@/lib/db/repositories/uploads";
import { resetServerEnv } from "@/lib/env";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { publishedListing } from "../uploads/helpers";
import { api, attachPhoto, member, seedReadyUpload, type ErrorBody, type ListingBody, type Member } from "./helpers";

beforeAll(() => resetServerEnv());
beforeEach(() => {
  resetRateLimiters();
  race.during = null;
  race.fresh = "";
  race.times = 0;
  race.tries = 0;
});

async function draft(owner: Member): Promise<string> {
  const created = await api<CreateListingResponse>(create, "POST", "/api/listings", { member: owner, body: { subcategoryId: "velos" } });
  expect(created.status).toBe(201);
  return created.body.id;
}

describe("PATCH /api/listings/{id} racing the photo pipeline", () => {
  it("saves the photo order of a draft while the pipeline attaches another photo (no 409)", async () => {
    const owner = await member();
    const id = await draft(owner);
    const first = await seedReadyUpload(owner, id);
    const second = await seedReadyUpload(owner, id);
    // The browser heard of the first photo; the pipeline attaches the second during the save.
    race.during = () => attachPhoto(id, second);
    race.fresh = first;
    race.times = 1;

    const saved = await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [first, second], title: "Vélo de ville Peugeot" } });
    expect(saved.status).toBe(200);
    expect(saved.body.listing.photos.map((photo) => photo.id)).toEqual([first, second]);
    const stored = await getListing(id);
    expect(stored?.photos.map((photo) => photo.id)).toEqual([first, second]);
    expect(stored?.title).toBe("Vélo de ville Peugeot");
    // Pipeline attach + the redone save, on the second try.
    expect(stored?.version).toBe(2);
    expect(race.tries).toBe(2);
  });

  it("still answers 409 when the draft keeps changing under every try", async () => {
    const owner = await member();
    const id = await draft(owner);
    const first = await seedReadyUpload(owner, id);
    race.during = () => updateListing(id, { title: "Changé ailleurs" });
    race.fresh = first;
    race.times = 10;

    const saved = await api<ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [first] } });
    expect(saved.status).toBe(409);
    expect(saved.body.error.code).toBe("conflict");
    // Three tries, each lost: the draft never got the photo.
    expect(race.tries).toBe(3);
    expect((await getListing(id))?.photos).toEqual([]);
  });

  it("leaves a live listing's race to the owner (409, not redone)", async () => {
    const owner = await member();
    const { id, photoIds } = await publishedListing(owner, 1);
    const extra = await seedReadyUpload(owner, id);
    race.during = () => updateListing(id, { title: "Changé ailleurs" });
    race.fresh = extra;
    race.times = 10;

    const saved = await api<ErrorBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [...photoIds, extra] } });
    expect(saved.status).toBe(409);
    expect(saved.body.error.code).toBe("conflict");
    // One try: the fresh read, and the screening's read of the new photo set (no second try).
    expect(race.tries).toBeLessThanOrEqual(2);
    expect((await getListing(id))?.photos.map((photo) => photo.id)).toEqual(photoIds);
  });
});
