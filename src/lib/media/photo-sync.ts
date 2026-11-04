import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { serverEnv } from "@/lib/env";
import { isListingId } from "@/lib/listings/ids";
import { clientOptions } from "@/lib/valkey/clients";

// Job "sync-listing-photos" {listingId} of the "media" queue (audit C-3): one listing's photos
// moved to the bucket its state calls for (src/worker/jobs/listing-photos.ts), processed one at a
// time with the photo pipeline. Kept apart from ./queue.ts so its producers (the search worker, the
// pipeline) do not load the pipeline. Worker only: the web never moves photos. Payloads hold a
// listing id only.

/** The media queue (./queue.ts MEDIA_QUEUE; a unit test keeps both equal). */
export const PHOTO_SYNC_QUEUE = "media";
export const LISTING_PHOTOS_JOB = "sync-listing-photos";
export const ENQUEUE_TIMEOUT_MS = 5_000;

// Five attempts over about eight minutes cover a storage or Firestore blip; the hourly
// purge-quarantine scan backs the hiding direction up.
export const LISTING_PHOTOS_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 3_600, count: 500 },
} as const;

export interface ListingPhotosJobData {
  listingId: string;
}

export function isListingPhotosJobData(value: unknown): value is ListingPhotosJobData {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  const listingId: unknown = (value as Record<string, unknown>).listingId;
  return keys.length === 1 && keys[0] === "listingId" && typeof listingId === "string" && isListingId(listingId);
}

/** BullMQ job id: the same listing version queued twice runs once, a later change gets its own run. */
export function listingPhotosJobId(listingId: string, version: number): string {
  return `photos-${listingId}-${version}`;
}

let queue: Queue | undefined;
let connection: Redis | undefined;

function photoSyncQueue(url: string): Queue {
  if (queue) return queue;
  connection = new Redis(url, clientOptions("queue", { lazyConnect: false, maxRetriesPerRequest: null }));
  queue = new Queue(PHOTO_SYNC_QUEUE, { connection });
  return queue;
}

/**
 * Queues the photo sync of a listing; `version` (the listing version that asked for it, when
 * known) names the job. False when no queue is configured (local dev, tests: nothing moves).
 */
export async function enqueueListingPhotoSync(listingId: string, version?: number | null): Promise<boolean> {
  const url = serverEnv().QUEUE_REDIS_URL;
  if (!url) return false;
  if (!isListingId(listingId)) throw new Error("invalid listing id");
  const data: ListingPhotosJobData = { listingId };
  const opts = { ...LISTING_PHOTOS_JOB_OPTIONS, ...(typeof version === "number" ? { jobId: listingPhotosJobId(listingId, version) } : {}) };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("listing photos job not enqueued in time")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([photoSyncQueue(url).add(LISTING_PHOTOS_JOB, data, opts), timeout]);
  } finally {
    clearTimeout(timer);
  }
  return true;
}

/** Tests and shutdown: closes the producer and its connection. */
export async function closePhotoSyncQueue(): Promise<void> {
  const current = queue;
  const client = connection;
  queue = undefined;
  connection = undefined;
  await current?.close();
  await client?.quit().catch(() => undefined);
}
