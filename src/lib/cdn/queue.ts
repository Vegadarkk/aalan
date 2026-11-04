import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logging/logger";
import { isValidObjectKey } from "@/lib/storage/keys";
import { clientOptions } from "@/lib/valkey/clients";
import { z } from "@/lib/zod";
import { cdnPurger, isCdnPurgeConfigured, mediaPurgeUrls, PURGE_BATCH } from "./index";

// Queue "cdn" on valkey-queue (audit A4-04): every deletion from the public media bucket (a photo
// deleted, rejected, moved to the private bucket with its removed, refused or hidden listing,
// purged with it; a
// replaced Pro logo) asks for its URL to leave the edge cache, after the object is gone (R2 is
// strongly consistent: the next edge fetch gets the 404). The worker purges one job at a time
// (src/worker/jobs/cdn-purge.ts), with retries over about eight hours: a Cloudflare outage or a
// token being replaced does not leave a deleted photo cached. Without QUEUE_REDIS_URL (local dev,
// tests) the purge runs inline instead. Payloads hold object keys only (ids, no personal data).

export const CDN_QUEUE = "cdn";
export const CDN_PURGE_JOB = "purge-media";
export const CDN_CONCURRENCY = 1;
export const ENQUEUE_TIMEOUT_MS = 5_000;

// 10 attempts from 30 s doubling: the last one about 4 h after the ninth, 8.5 h in all.
export const CDN_JOB_OPTIONS = {
  attempts: 10,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 3_600, count: 500 },
} as const;

export const cdnPurgeJobSchema = z
  .object({ keys: z.array(z.string().refine(isValidObjectKey, "invalid object key")).min(1).max(PURGE_BATCH) })
  .strict();
export type CdnPurgeJobData = z.infer<typeof cdnPurgeJobSchema>;

let queue: Queue | undefined;
let connection: Redis | undefined;

function cdnQueue(url: string): Queue {
  if (queue) return queue;
  connection = new Redis(url, clientOptions("queue", { lazyConnect: false, maxRetriesPerRequest: null }));
  queue = new Queue(CDN_QUEUE, { connection });
  return queue;
}

async function enqueue(url: string, data: CdnPurgeJobData): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("CDN purge job not enqueued in time")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([cdnQueue(url).add(CDN_PURGE_JOB, data, CDN_JOB_OPTIONS), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks for media bucket keys to leave the edge cache: queued with Valkey, inline otherwise. Nothing
 * happens when purging is not configured. Throws when the job cannot be queued (or, inline, when
 * the purge fails): the caller logs it, the deletion itself stands.
 */
export async function scheduleMediaPurge(keys: readonly string[]): Promise<void> {
  const env = serverEnv();
  if (!isCdnPurgeConfigured(env)) return;
  const data = cdnPurgeJobSchema.parse({ keys: [...new Set(keys)] });
  if (env.QUEUE_REDIS_URL) {
    await enqueue(env.QUEUE_REDIS_URL, data);
    return;
  }
  const urls = mediaPurgeUrls(data.keys, env);
  const purger = cdnPurger();
  if (!urls || !purger) return;
  await purger.purgeUrls(urls);
  logger.info({ urls: urls.length }, "CDN purge done inline");
}

/** Tests and shutdown: closes the producer and its connection. */
export async function closeCdnQueue(): Promise<void> {
  const current = queue;
  const client = connection;
  queue = undefined;
  connection = undefined;
  await current?.close();
  await client?.quit().catch(() => undefined);
}
