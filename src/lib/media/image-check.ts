import "server-only";
import { randomUUID } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import { DEFAULT_AI, type AiConfig } from "@/config/ai";
import { serverEnv } from "@/lib/env";
import { unavailable } from "@/lib/http/errors";
import { logger } from "@/lib/logging/logger";
import type { ObjectStore } from "@/lib/storage";
import { imageClassifier, type ImageClassification, type ImageClassifier } from "./classify";
import { ENQUEUE_TIMEOUT_MS, isMediaQueueEnabled, mediaProducer } from "./queue";

// Checks of the images the web stores itself while the member waits: the profile photo
// (src/lib/account/avatar.ts) and the shop logo (src/lib/pro/logo.ts). The ONNX models ship in the
// worker image only (docker/Dockerfile): with the media queue on, the web puts the encoded image in
// the quarantine bucket under a random key, adds a "check-image" job holding that key only to the
// media queue (lifo: ahead of waiting uploads, whose wizard polls anyway), and polls the job for the
// scores. The object is deleted once answered; the quarantine bucket's one-day lifecycle catches a
// failed delete. No answer in time, a failed job or Valkey away: 503 and the member retries, never
// an unchecked image. Without QUEUE_REDIS_URL (dev, tests) the local classifier answers in process.

export const IMAGE_CHECK_JOB = "check-image";
export const IMAGE_CHECK_PREFIX = "checks/";
/** Encoded images only (WebP logo 512 px, avatar 320x400): far below this. */
export const IMAGE_CHECK_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_CHECK_TIMEOUT_MS = 30_000;
export const IMAGE_CHECK_POLL_MS = 250;

/** One attempt (the member retries), answer kept ten minutes for the poll, lifo ahead of uploads. */
export const IMAGE_CHECK_JOB_OPTIONS = {
  attempts: 1,
  lifo: true,
  removeOnComplete: { age: 600 },
  removeOnFail: { age: 600 },
} as const;

const CHECK_KEY = /^checks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ImageCheckJobData {
  key: string;
}

export function isImageCheckJobData(value: unknown): value is ImageCheckJobData {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  const key = (value as ImageCheckJobData).key;
  return keys.length === 1 && keys[0] === "key" && typeof key === "string" && CHECK_KEY.test(key);
}

export function imageCheckJobId(key: string): string {
  return `check-${key.slice(IMAGE_CHECK_PREFIX.length)}`;
}

function isClassification(value: unknown): value is ImageClassification {
  if (typeof value !== "object" || value === null) return false;
  const { nsfw, faces } = value as ImageClassification;
  return typeof nsfw === "number" && nsfw >= 0 && nsfw <= 1 && Number.isInteger(faces) && faces >= 0;
}

/** What the web needs of the BullMQ queue (mocked in tests). */
export interface ImageCheckQueue {
  add(name: string, data: ImageCheckJobData, opts: Record<string, unknown>): Promise<unknown>;
  getJob(id: string): Promise<{ returnvalue: unknown; failedReason?: string; finishedOn?: number } | undefined>;
  remove(id: string): Promise<unknown>;
}

export interface WorkerClassifierOptions {
  timeoutMs?: number;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `promise`, or a 503 once `ms` have passed (the producer connection queues commands while Valkey is away). */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(unavailable(`image check: ${what} timed out`)), Math.max(ms, 1));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The worker's classifier, reached through the media queue. */
export class WorkerImageClassifier implements ImageClassifier {
  readonly name = "worker";

  constructor(
    private readonly queue: () => ImageCheckQueue,
    private readonly store: ObjectStore,
    private readonly options: WorkerClassifierOptions = {},
  ) {}

  async classify(image: Buffer): Promise<ImageClassification> {
    if (image.byteLength > IMAGE_CHECK_MAX_BYTES) throw new Error("image check: encoded image over the cap");
    const timeoutMs = this.options.timeoutMs ?? IMAGE_CHECK_TIMEOUT_MS;
    const pollMs = this.options.pollMs ?? IMAGE_CHECK_POLL_MS;
    const key = `${IMAGE_CHECK_PREFIX}${randomUUID()}`;
    const jobId = imageCheckJobId(key);
    await this.store.put("quarantine", key, image, { contentType: "image/webp" });
    try {
      const queue = this.queue();
      await within(queue.add(IMAGE_CHECK_JOB, { key }, { ...IMAGE_CHECK_JOB_OPTIONS, jobId }), ENQUEUE_TIMEOUT_MS, "enqueue");
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(pollMs);
        const job = await within(queue.getJob(jobId), deadline - Date.now(), "poll");
        if (!job) throw unavailable("image check: job gone");
        if (!job.finishedOn) continue;
        if (job.failedReason) {
          logger.error({ jobId, err: job.failedReason }, "image check failed in the worker");
          throw unavailable("image check failed");
        }
        if (!isClassification(job.returnvalue)) throw unavailable("image check: unexpected answer");
        return job.returnvalue;
      }
      // Still waiting: dropped (an active job cannot be removed; its answer then expires unread).
      await within(queue.remove(jobId), 1_000, "remove").catch(() => undefined);
      logger.warn({ jobId, timeoutMs }, "image check not answered in time");
      throw unavailable("image check timed out");
    } finally {
      await this.store.delete("quarantine", key).catch((error: unknown) => logger.warn({ err: (error as Error).message }, "image check object not deleted"));
    }
  }
}

/** The classifier of the upload routes: the worker's through the media queue, the local one without it. */
export function uploadImageClassifier(store: ObjectStore, ai: AiConfig = DEFAULT_AI): ImageClassifier {
  if (isMediaQueueEnabled()) return new WorkerImageClassifier(mediaProducer, store);
  return imageClassifier(serverEnv(), ai);
}

export interface ImageCheckDeps {
  store: ObjectStore;
  classifier?: ImageClassifier;
}

/** Worker side of a "check-image" job: the scores of the quarantined image. */
export async function processImageCheck(data: ImageCheckJobData, deps: ImageCheckDeps): Promise<ImageClassification> {
  const image = await deps.store.get("quarantine", data.key, { maxBytes: IMAGE_CHECK_MAX_BYTES });
  // Gone: the web timed out and deleted it; nobody waits for an answer.
  if (!image) throw new UnrecoverableError("image check object missing");
  if (image.byteLength > IMAGE_CHECK_MAX_BYTES) throw new UnrecoverableError("image check object over the cap");
  const classifier = deps.classifier ?? imageClassifier(serverEnv());
  return classifier.classify(image);
}
