import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingRecord } from "@/lib/db/repositories/listings";
import type { UploadRecord } from "@/lib/db/repositories/uploads";

// sync-listing-photos (media queue, audit C-3): a removed, refused or hidden listing's public photos
// go to the private bucket (retainListingPhotos), a listing in public view gets its `ready` private
// photos back (releaseUpload); nothing moves for a purged or missing listing, without storage or
// Firebase, or while the Firestore write quota is degraded. The moves themselves are tested with
// purge-quarantine (jobs-purge-quarantine.test.ts).

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("@/lib/quota", () => ({ isDegraded: vi.fn(async () => false) }));
const configured = { value: true };
vi.mock("@/lib/firebase/admin", () => ({ isFirestoreConfigured: () => configured.value }));
vi.mock("@/lib/db/repositories/listings", () => ({ getListing: vi.fn(async () => null) }));
vi.mock("@/lib/db/repositories/uploads", () => ({ listPrivateUploadsByTarget: vi.fn(async () => []) }));
vi.mock("@/worker/jobs/purge-quarantine", () => ({
  retainListingPhotos: vi.fn(async (_store: unknown, _listing: unknown, _now: Date, tally: { retained: number }) => {
    tally.retained += 2;
  }),
  releaseUpload: vi.fn(async () => true),
}));

const { getListing } = await import("@/lib/db/repositories/listings");
const { listPrivateUploadsByTarget } = await import("@/lib/db/repositories/uploads");
const { isDegraded } = await import("@/lib/quota");
const { releaseUpload, retainListingPhotos } = await import("@/worker/jobs/purge-quarantine");
const { MemoryObjectStore } = await import("@/lib/storage/memory");
const { syncListingPhotos } = await import("@/worker/jobs/listing-photos");

const NOW = new Date("2026-11-04T10:00:00Z");
const ID = "abcd2345";
const store = new MemoryObjectStore();
const hiddenBy = { reportId: "report-1", signal: "decision" as const, at: NOW };

function listing(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return { id: ID, status: "published", photos: [], legalHold: [], moderation: { state: "auto_ok", score: 0, flags: [], openReports: 0 }, ...overrides } as unknown as ListingRecord;
}

function upload(id: string, overrides: Partial<UploadRecord> = {}): UploadRecord {
  return { id, purpose: "listing", targetId: ID, status: "ready", bucket: "private", ...overrides } as UploadRecord;
}

beforeEach(() => {
  configured.value = true;
  vi.mocked(getListing).mockReset().mockResolvedValue(null);
  vi.mocked(listPrivateUploadsByTarget).mockReset().mockResolvedValue([]);
  vi.mocked(retainListingPhotos).mockClear();
  vi.mocked(releaseUpload).mockReset().mockResolvedValue(true);
  vi.mocked(isDegraded).mockReset().mockResolvedValue(false);
});

describe("syncListingPhotos", () => {
  it.each([
    ["refused", { status: "rejected" }],
    ["removed", { status: "removed" }],
    ["hidden by a report", { moderation: { state: "auto_ok", score: 0, flags: [], openReports: 1, hiddenBy } }],
    ["hidden while paused", { status: "paused", moderation: { state: "human_ok", score: 0, flags: [], openReports: 0, hiddenBy } }],
  ] as const)("moves the public photos of a %s listing to the private bucket", async (_label, overrides) => {
    const record = listing(overrides as Partial<ListingRecord>);
    vi.mocked(getListing).mockResolvedValue(record);
    expect(await syncListingPhotos(ID, NOW, { store })).toEqual({ action: "retain", retained: 2, released: 0, failed: 0 });
    expect(retainListingPhotos).toHaveBeenCalledWith(store, record, NOW, expect.objectContaining({ retained: 2 }));
    expect(listPrivateUploadsByTarget).not.toHaveBeenCalled();
  });

  it.each(["published", "paused", "sold", "expired", "pending_review", "draft"] as const)("brings the ready private photos of a %s listing back to the media bucket", async (status) => {
    vi.mocked(getListing).mockResolvedValue(listing({ status }));
    const ready = upload("photo0000001");
    // Deleted by its owner under a legal hold: stays private; a KYBC piece is never a listing photo.
    const held = upload("photo0000002", { status: "rejected", heldObjects: true });
    const kyb = upload("kyb000000001", { purpose: "kyb" });
    vi.mocked(listPrivateUploadsByTarget).mockResolvedValue([ready, held, kyb]);
    expect(await syncListingPhotos(ID, NOW, { store })).toEqual({ action: "release", retained: 0, released: 1, failed: 0 });
    expect(listPrivateUploadsByTarget).toHaveBeenCalledWith(ID);
    expect(vi.mocked(releaseUpload).mock.calls).toEqual([[store, ready, NOW]]);
    expect(retainListingPhotos).not.toHaveBeenCalled();
  });

  it("throws after trying every photo when a move back fails (BullMQ retries; what moved stays moved)", async () => {
    vi.mocked(getListing).mockResolvedValue(listing());
    vi.mocked(listPrivateUploadsByTarget).mockResolvedValue([upload("photo0000001"), upload("photo0000002")]);
    vi.mocked(releaseUpload).mockRejectedValueOnce(new Error("R2 500"));
    await expect(syncListingPhotos(ID, NOW, { store })).rejects.toThrow(/1 photo\(s\) of listing abcd2345/);
    expect(releaseUpload).toHaveBeenCalledTimes(2);
  });

  it("moves nothing for a missing or purged listing, without Firebase, or while the write quota is degraded", async () => {
    expect(await syncListingPhotos(ID, NOW, { store })).toMatchObject({ action: "none" });
    vi.mocked(getListing).mockResolvedValue(listing({ status: "purged", moderation: { state: "auto_ok", score: 0, flags: [], openReports: 0, hiddenBy } } as Partial<ListingRecord>));
    expect(await syncListingPhotos(ID, NOW, { store })).toMatchObject({ action: "none" });
    vi.mocked(getListing).mockResolvedValue(listing({ status: "rejected" }));
    vi.mocked(isDegraded).mockImplementation(async (id) => id === "firestore.writes");
    expect(await syncListingPhotos(ID, NOW, { store })).toMatchObject({ action: "none" });
    configured.value = false;
    vi.mocked(isDegraded).mockResolvedValue(false);
    expect(await syncListingPhotos(ID, NOW, { store })).toMatchObject({ action: "none" });
    expect(retainListingPhotos).not.toHaveBeenCalled();
    expect(releaseUpload).not.toHaveBeenCalled();
  });
});
