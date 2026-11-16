import type * as BullMq from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Profile photo and shop logo checks (src/lib/media/image-check.ts): the ONNX models ship in the
// worker image only, so with the media queue on the web hands the image to the worker and waits
// for the scores; without the queue (dev, tests) the local classifier answers in process.

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));
vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof BullMq>();
  class Queue {
    constructor(readonly name: string) {}
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
const { StubImageClassifier } = await import("@/lib/media/classify");
const check = await import("@/lib/media/image-check");
const { closeMediaQueue } = await import("@/lib/media/queue");
const { processMediaJob, onMediaJobFailed } = await import("@/worker/jobs/media");
const { MemoryObjectStore, resetObjectStore, setObjectStoreForTests } = await import("@/lib/storage");

type Job = { data: { key: string }; opts: Record<string, unknown>; returnvalue: unknown; failedReason?: string; finishedOn?: number };

/** A media queue whose "worker" runs `run` on the job at the first poll (or never). */
function fakeQueue(run: ((job: Job) => Promise<void>) | null) {
  const jobs = new Map<string, Job>();
  const removed: string[] = [];
  const queue = {
    added: [] as { name: string; data: unknown; opts: Record<string, unknown> }[],
    removed,
    async add(name: string, data: { key: string }, opts: Record<string, unknown>) {
      queue.added.push({ name, data, opts });
      jobs.set(String(opts.jobId), { data, opts, returnvalue: null });
      return { id: opts.jobId };
    },
    async getJob(id: string) {
      const job = jobs.get(id);
      if (job && !job.finishedOn && run) {
        await run(job);
        job.finishedOn = Date.now();
      }
      return job;
    },
    async remove(id: string) {
      removed.push(id);
      jobs.delete(id);
      return 1;
    },
  };
  return queue;
}

const IMAGE = Buffer.from("RIFF....WEBPVP8 fake image bytes");
const FAST = { pollMs: 1, timeoutMs: 200 };

beforeEach(() => resetServerEnv());

afterEach(async () => {
  delete process.env.QUEUE_REDIS_URL;
  resetServerEnv();
  resetObjectStore();
  await closeMediaQueue();
});

describe("upload image checks", () => {
  it("go to the worker when the media queue is on, and stay local without it (dev, tests)", () => {
    const store = new MemoryObjectStore();
    delete process.env.QUEUE_REDIS_URL;
    resetServerEnv();
    expect(check.uploadImageClassifier(store).name).not.toBe("worker");
    process.env.QUEUE_REDIS_URL = "redis://127.0.0.1:6399";
    resetServerEnv();
    // The web image has no model files: with the queue on it must never classify in process.
    expect(check.uploadImageClassifier(store)).toBeInstanceOf(check.WorkerImageClassifier);
  });

  it("returns the worker's scores; the job holds a random key only and the image is deleted after", async () => {
    const store = new MemoryObjectStore();
    const worker = new StubImageClassifier({ nsfw: 0.97, faces: 1 });
    const queue = fakeQueue(async (job) => {
      // The worker processor, on the same store, through the media job router.
      job.returnvalue = await check.processImageCheck(job.data, { store, classifier: worker });
    });
    const classifier = new check.WorkerImageClassifier(() => queue, store, FAST);
    expect(await classifier.classify(IMAGE)).toEqual({ nsfw: 0.97, faces: 1 });
    expect(worker.calls).toBe(1);
    expect(queue.added).toHaveLength(1);
    const [added] = queue.added;
    expect(added?.name).toBe(check.IMAGE_CHECK_JOB);
    expect(Object.keys(added?.data as object)).toEqual(["key"]);
    expect(check.isImageCheckJobData(added?.data)).toBe(true);
    expect(added?.opts).toMatchObject({ attempts: 1, lifo: true, jobId: check.imageCheckJobId((added?.data as { key: string }).key) });
    expect(await store.head("quarantine", (added?.data as { key: string }).key)).toBeNull();
  });

  it("answers 503 on a failed job, an odd answer or no answer in time, never a score", async () => {
    const store = new MemoryObjectStore();
    const failed = fakeQueue(async (job) => {
      job.failedReason = "photo checks unavailable: ONNX model files missing";
    });
    await expect(new check.WorkerImageClassifier(() => failed, store, FAST).classify(IMAGE)).rejects.toMatchObject({ status: 503 });

    const odd = fakeQueue(async (job) => {
      job.returnvalue = { nsfw: "low" };
    });
    await expect(new check.WorkerImageClassifier(() => odd, store, FAST).classify(IMAGE)).rejects.toMatchObject({ status: 503 });

    const silent = fakeQueue(null);
    await expect(new check.WorkerImageClassifier(() => silent, store, { pollMs: 5, timeoutMs: 30 }).classify(IMAGE)).rejects.toMatchObject({ status: 503 });
    expect(silent.removed).toHaveLength(1);

    for (const queue of [failed, odd, silent]) {
      const key = (queue.added[0]?.data as { key: string }).key;
      expect(await store.head("quarantine", key)).toBeNull();
    }
  });

  it("refuses oversized images before storing anything", async () => {
    const store = new MemoryObjectStore();
    const queue = fakeQueue(null);
    await expect(new check.WorkerImageClassifier(() => queue, store, FAST).classify(Buffer.alloc(check.IMAGE_CHECK_MAX_BYTES + 1))).rejects.toThrow(/over the cap/);
    expect(queue.added).toEqual([]);
  });

  it("validates job payloads strictly", () => {
    expect(check.isImageCheckJobData({ key: "checks/123e4567-e89b-42d3-a456-426614174000" })).toBe(true);
    for (const value of [null, "x", {}, { key: "checks/../media/x" }, { key: "avatars/123e4567-e89b-42d3-a456-426614174000" }, { key: "checks/123e4567-e89b-42d3-a456-426614174000", extra: 1 }, { uploadId: "upl00001abcdefgh" }]) {
      expect(check.isImageCheckJobData(value)).toBe(false);
    }
  });
});

describe("image check worker job", () => {
  const KEY = "checks/123e4567-e89b-42d3-a456-426614174000";

  it("is routed by the media processor; a malformed or vanished one fails without retries", async () => {
    const store = new MemoryObjectStore();
    setObjectStoreForTests(store);
    await store.put("quarantine", KEY, IMAGE, { contentType: "image/webp" });
    // Dev env, no model files: the stub answers clean.
    expect(await processMediaJob({ id: "c1", name: check.IMAGE_CHECK_JOB, data: { key: KEY } })).toEqual({ nsfw: 0, faces: 0 });
    await expect(processMediaJob({ id: "c2", name: check.IMAGE_CHECK_JOB, data: { key: "media/x" } })).rejects.toBeInstanceOf(UnrecoverableError);
    await store.delete("quarantine", KEY);
    await expect(processMediaJob({ id: "c3", name: check.IMAGE_CHECK_JOB, data: { key: KEY } })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await onMediaJobFailed({ name: check.IMAGE_CHECK_JOB, data: { key: KEY }, attemptsMade: 1, opts: { attempts: 1 } }, new Error("x"))).toBe(true);
  });
});
