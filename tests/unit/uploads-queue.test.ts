import type * as BullMq from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Queue "media" (D12): job payload validation, one job id per upload, inline processing without
// QUEUE_REDIS_URL, enqueue with Valkey; the worker's processor and its last-attempt expiry. The
// same queue carries the photo sync of a listing (audit C-3, src/lib/media/photo-sync.ts).

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("@/lib/media/pipeline", () => ({
  processUpload: vi.fn(async () => ({ status: "ready", photo: { id: "upl00001abcdefgh", w: 10, h: 10, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" } })),
  expireUpload: vi.fn(async () => ({ status: "rejected", rejectReason: "expired" })),
}));
vi.mock("@/worker/jobs/listing-photos", () => ({ syncListingPhotos: vi.fn(async () => ({ action: "none", retained: 0, released: 0, failed: 0 })) }));
const added: { name: string; data: unknown; opts: Record<string, unknown> }[] = [];
const valkeyDown = { value: false };
const queues: string[] = [];
vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof BullMq>();
  class Queue {
    constructor(readonly name: string) {
      queues.push(name);
    }
    async add(name: string, data: unknown, opts: Record<string, unknown>) {
      // Offline queue of the producer connection: the command waits for a reconnection.
      if (valkeyDown.value) return new Promise(() => undefined);
      added.push({ name, data, opts });
      return { id: opts.jobId };
    }
    async close() {}
  }
  return { ...actual, Queue };
});
vi.mock("ioredis", () => ({
  Redis: class {
    quit = vi.fn(async () => "OK");
    on = vi.fn();
  },
}));

const { UnrecoverableError } = await import("bullmq");
const { resetServerEnv } = await import("@/lib/env");
const { processUpload, expireUpload } = await import("@/lib/media/pipeline");
const { ENQUEUE_TIMEOUT_MS, MEDIA_CONCURRENCY, MEDIA_JOB, MEDIA_JOB_OPTIONS, MEDIA_QUEUE, closeMediaQueue, dispatchUpload, enqueueMediaJob, isMediaJobData, isMediaQueueEnabled, mediaJobId } = await import("@/lib/media/queue");
const { onMediaJobFailed, processMediaJob } = await import("@/worker/jobs/media");
const photoSync = await import("@/lib/media/photo-sync");
const { syncListingPhotos } = await import("@/worker/jobs/listing-photos");

const ID = "upl00001abcdefgh";

beforeEach(() => {
  valkeyDown.value = false;
  added.length = 0;
  queues.length = 0;
  vi.mocked(processUpload).mockClear();
  vi.mocked(expireUpload).mockClear();
});

afterEach(async () => {
  delete process.env.QUEUE_REDIS_URL;
  resetServerEnv();
  await closeMediaQueue();
  await photoSync.closePhotoSyncQueue();
});

describe("media queue", () => {
  it("validates payloads strictly (an upload id and nothing else)", () => {
    expect(isMediaJobData({ uploadId: ID })).toBe(true);
    expect(isMediaJobData({ uploadId: "../etc" })).toBe(false);
    expect(isMediaJobData({ uploadId: ID, extra: 1 })).toBe(false);
    expect(isMediaJobData(null)).toBe(false);
    expect(isMediaJobData("x")).toBe(false);
  });

  it("uses one BullMQ job id per upload (no ':' and never numeric)", () => {
    expect(mediaJobId(ID)).toBe(`upload-${ID}`);
    expect(MEDIA_QUEUE).toBe("media");
    expect(MEDIA_CONCURRENCY).toBe(1);
    expect(MEDIA_JOB_OPTIONS.attempts).toBeGreaterThan(1);
  });

  it("runs the pipeline inline without QUEUE_REDIS_URL", async () => {
    delete process.env.QUEUE_REDIS_URL;
    resetServerEnv();
    expect(isMediaQueueEnabled()).toBe(false);
    expect(await dispatchUpload(ID)).toMatchObject({ status: "ready" });
    expect(processUpload).toHaveBeenCalledWith(ID, {});
    expect(added).toEqual([]);
    await expect(enqueueMediaJob(ID)).rejects.toThrow(/QUEUE_REDIS_URL/);
  });

  it("enqueues on the media queue with Valkey and answers processing", async () => {
    process.env.QUEUE_REDIS_URL = "redis://127.0.0.1:6399";
    resetServerEnv();
    expect(isMediaQueueEnabled()).toBe(true);
    expect(await dispatchUpload(ID)).toEqual({ status: "processing" });
    expect(processUpload).not.toHaveBeenCalled();
    expect(queues).toEqual([MEDIA_QUEUE]);
    expect(added).toEqual([{ name: MEDIA_JOB, data: { uploadId: ID }, opts: { ...MEDIA_JOB_OPTIONS, jobId: `upload-${ID}` } }]);
    await enqueueMediaJob(ID);
    // One producer per process.
    expect(queues).toEqual([MEDIA_QUEUE]);
    await expect(enqueueMediaJob("bad id")).rejects.toThrow();
  });

  it("gives up on an add that waits for Valkey, so the complete route can answer 503", async () => {
    process.env.QUEUE_REDIS_URL = "redis://127.0.0.1:6399";
    resetServerEnv();
    valkeyDown.value = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = expect(dispatchUpload(ID)).rejects.toThrow(/not enqueued/);
      await vi.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("media worker job", () => {
  it("processes a valid job and refuses a malformed one without retries", async () => {
    expect(await processMediaJob({ id: "1", name: MEDIA_JOB, data: { uploadId: ID } })).toMatchObject({ status: "ready" });
    expect(processUpload).toHaveBeenCalledWith(ID);
    await expect(processMediaJob({ id: "2", name: MEDIA_JOB, data: { uploadId: 42 } })).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("expires the upload after the last failed attempt only", async () => {
    const job = (attemptsMade: number) => ({ name: MEDIA_JOB, data: { uploadId: ID }, attemptsMade, opts: { attempts: 3 } });
    expect(await onMediaJobFailed(job(1), new Error("timeout"))).toBe(false);
    expect(expireUpload).not.toHaveBeenCalled();
    expect(await onMediaJobFailed(job(3), new Error("timeout"))).toBe(true);
    expect(expireUpload).toHaveBeenCalledWith(ID);
    expect(await onMediaJobFailed(undefined, new Error("x"))).toBe(false);
    vi.mocked(expireUpload).mockRejectedValueOnce(new Error("firestore down"));
    expect(await onMediaJobFailed(job(3), new Error("timeout"))).toBe(false);
  });
});

describe("listing photo sync jobs", () => {
  const LISTING = "abcd2345";

  it("share the media queue and accept a listing id only", () => {
    expect(photoSync.PHOTO_SYNC_QUEUE).toBe(MEDIA_QUEUE);
    expect(photoSync.isListingPhotosJobData({ listingId: LISTING })).toBe(true);
    for (const value of [null, {}, { listingId: "ABCD2345" }, { listingId: LISTING, extra: 1 }, { listingId: 42 }, { uploadId: ID }]) expect(photoSync.isListingPhotosJobData(value)).toBe(false);
  });

  it("are not queued without QUEUE_REDIS_URL, and named by listing version with it", async () => {
    expect(await photoSync.enqueueListingPhotoSync(LISTING, 3)).toBe(false);
    expect(added).toEqual([]);
    process.env.QUEUE_REDIS_URL = "redis://127.0.0.1:6399";
    resetServerEnv();
    expect(await photoSync.enqueueListingPhotoSync(LISTING, 3)).toBe(true);
    expect(await photoSync.enqueueListingPhotoSync(LISTING)).toBe(true);
    expect(queues).toEqual([MEDIA_QUEUE]);
    expect(added).toEqual([
      { name: photoSync.LISTING_PHOTOS_JOB, data: { listingId: LISTING }, opts: { ...photoSync.LISTING_PHOTOS_JOB_OPTIONS, jobId: `photos-${LISTING}-3` } },
      { name: photoSync.LISTING_PHOTOS_JOB, data: { listingId: LISTING }, opts: { ...photoSync.LISTING_PHOTOS_JOB_OPTIONS } },
    ]);
    await expect(photoSync.enqueueListingPhotoSync("../x")).rejects.toThrow(/invalid listing id/);
  });

  it("run the sync in the media worker, refuse a malformed payload, and expire no upload", async () => {
    expect(await processMediaJob({ id: "3", name: photoSync.LISTING_PHOTOS_JOB, data: { listingId: LISTING } })).toMatchObject({ action: "none" });
    expect(syncListingPhotos).toHaveBeenCalledWith(LISTING);
    expect(processUpload).not.toHaveBeenCalled();
    await expect(processMediaJob({ id: "4", name: photoSync.LISTING_PHOTOS_JOB, data: { uploadId: ID } })).rejects.toBeInstanceOf(UnrecoverableError);
    const job = (attemptsMade: number) => ({ name: photoSync.LISTING_PHOTOS_JOB, data: { listingId: LISTING }, attemptsMade, opts: { attempts: 5 } });
    expect(await onMediaJobFailed(job(2), new Error("r2 down"))).toBe(false);
    expect(await onMediaJobFailed(job(5), new Error("r2 down"))).toBe(true);
    expect(expireUpload).not.toHaveBeenCalled();
  });
});
