import type * as bullmq from "bullmq";
import { UnrecoverableError } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CdnPurgeError, MemoryCdnPurger, setCdnPurgerForTests } from "@/lib/cdn";
import { resetServerEnv } from "@/lib/env";

// Queue "cdn" (audit A4-04): what a media deletion asks for (queued with Valkey, inline without,
// nothing when the purge is not configured), the worker's processor and its final-failure alert,
// and the storage factory's wiring.

const added = vi.hoisted(() => [] as { name: string; data: unknown; opts: unknown }[]);
vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof bullmq>();
  class Queue {
    constructor(readonly queueName: string) {}
    async add(name: string, data: unknown, opts: unknown) {
      added.push({ name, data, opts });
      return { id: String(added.length) };
    }
    async close() {}
  }
  return { ...actual, Queue };
});
vi.mock("ioredis", () => ({ Redis: class { async quit() {} } }));
vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
const alert = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/alert", () => ({ alert }));
vi.mock("@/lib/quota", () => ({ consume: vi.fn(async () => ({ level: "ok" })), isDegraded: vi.fn(async () => false) }));

const { CDN_JOB_OPTIONS, CDN_PURGE_JOB, closeCdnQueue, scheduleMediaPurge } = await import("@/lib/cdn/queue");
const { onCdnPurgeJobFailed, processCdnPurgeJob } = await import("@/worker/jobs/cdn-purge");
const { createObjectStore } = await import("@/lib/storage");

const ZONE = "0123456789abcdef0123456789abcdef";
const TOKEN = ["fake", "purge", "token"].join("-");
const BASE = "https://media.joutiya.ma";
const KEYS = ["listings/l1/p-l.webp", "listings/l1/p-s.webp"];

function configure(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  resetServerEnv();
}

afterEach(async () => {
  vi.unstubAllEnvs();
  resetServerEnv();
  setCdnPurgerForTests(undefined);
  added.length = 0;
  await closeCdnQueue();
});

describe("scheduleMediaPurge", () => {
  it("does nothing while the purge is not configured", async () => {
    configure({ MEDIA_BASE_URL: BASE, QUEUE_REDIS_URL: "redis://valkey-queue:6379" });
    await scheduleMediaPurge(KEYS);
    expect(added).toEqual([]);
  });

  it("queues one job with the object keys (deduplicated) and the retry options", async () => {
    configure({ MEDIA_BASE_URL: BASE, CF_MEDIA_PURGE_TOKEN: TOKEN, CF_MEDIA_ZONE_ID: ZONE, QUEUE_REDIS_URL: "redis://valkey-queue:6379" });
    await scheduleMediaPurge([...KEYS, KEYS[0]!]);
    expect(added).toEqual([{ name: CDN_PURGE_JOB, data: { keys: KEYS }, opts: CDN_JOB_OPTIONS }]);
    expect(CDN_JOB_OPTIONS.attempts).toBeGreaterThanOrEqual(8);
  });

  it("purges inline without Valkey", async () => {
    configure({ MEDIA_BASE_URL: `${BASE}/`, CF_MEDIA_PURGE_TOKEN: TOKEN, CF_MEDIA_ZONE_ID: ZONE });
    const memory = new MemoryCdnPurger();
    setCdnPurgerForTests(memory);
    await scheduleMediaPurge(KEYS);
    expect(memory.purged).toEqual(KEYS.map((key) => `${BASE}/${key}`));
    expect(added).toEqual([]);
  });

  it("refuses a key that could escape the bucket", async () => {
    configure({ MEDIA_BASE_URL: BASE, CF_MEDIA_PURGE_TOKEN: TOKEN, CF_MEDIA_ZONE_ID: ZONE, QUEUE_REDIS_URL: "redis://valkey-queue:6379" });
    await expect(scheduleMediaPurge(["../private/x"])).rejects.toThrow();
    expect(added).toEqual([]);
  });
});

describe("processCdnPurgeJob", () => {
  it("purges the public URLs of the job's keys", async () => {
    const memory = new MemoryCdnPurger();
    expect(await processCdnPurgeJob({ id: "1", data: { keys: KEYS } }, { purger: memory, mediaBaseUrl: BASE })).toBe(2);
    expect(memory.purged).toEqual([`${BASE}/listings/l1/p-l.webp`, `${BASE}/listings/l1/p-s.webp`]);
  });

  it("rejects a malformed payload at once", async () => {
    for (const data of [{}, { keys: [] }, { keys: ["../x"] }, { keys: KEYS, extra: 1 }]) {
      await expect(processCdnPurgeJob({ id: "1", data }, { purger: new MemoryCdnPurger(), mediaBaseUrl: BASE })).rejects.toBeInstanceOf(UnrecoverableError);
    }
  });

  it("drops the job when the purge is no longer configured", async () => {
    expect(await processCdnPurgeJob({ id: "1", data: { keys: KEYS } }, { purger: null, mediaBaseUrl: BASE })).toBe(0);
    configure({});
    expect(await processCdnPurgeJob({ id: "1", data: { keys: KEYS } }, { purger: new MemoryCdnPurger() })).toBe(0);
  });

  it("lets BullMQ retry a refused request, and stops on a malformed one", async () => {
    const transient = { name: "x", purgeUrls: async () => Promise.reject(new CdnPurgeError(429)) };
    await expect(processCdnPurgeJob({ id: "1", data: { keys: KEYS } }, { purger: transient, mediaBaseUrl: BASE })).rejects.toBeInstanceOf(CdnPurgeError);
    const permanent = { name: "x", purgeUrls: async () => Promise.reject(new CdnPurgeError(400, [1012])) };
    await expect(processCdnPurgeJob({ id: "1", data: { keys: KEYS } }, { purger: permanent, mediaBaseUrl: BASE })).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe("onCdnPurgeJobFailed", () => {
  const job = (attemptsMade: number) => ({ data: { keys: KEYS }, attemptsMade, opts: { attempts: CDN_JOB_OPTIONS.attempts } });

  it("waits for the final attempt, then alerts with the keys", async () => {
    expect(await onCdnPurgeJobFailed(job(1), new Error("HTTP 503"))).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    expect(await onCdnPurgeJobFailed(job(CDN_JOB_OPTIONS.attempts), new Error("CDN purge failed with HTTP 403"))).toBe(true);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ severity: "P2", title: "Purge du cache CDN en échec", body: expect.stringContaining(KEYS[0]!) }));
    expect(await onCdnPurgeJobFailed(job(1), new UnrecoverableError("bad"))).toBe(true);
  });
});

describe("storage factory", () => {
  const r2 = {
    R2_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "fake-id",
    R2_SECRET_ACCESS_KEY: "fake-secret",
    R2_BUCKET_QUARANTINE: "joutiya-staging-quarantine",
    R2_BUCKET_MEDIA: "joutiya-staging-media",
    R2_BUCKET_PRIVATE: "joutiya-staging-private",
    MEDIA_BASE_URL: BASE,
  };

  it("queues the purge of a media object R2 deleted, only when the purge is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
    configure({ ...r2, QUEUE_REDIS_URL: "redis://valkey-queue:6379" });
    const { serverEnv } = await import("@/lib/env");
    await createObjectStore(serverEnv()).delete("media", KEYS[0]!);
    expect(added).toEqual([]);
    configure({ ...r2, QUEUE_REDIS_URL: "redis://valkey-queue:6379", CF_MEDIA_PURGE_TOKEN: TOKEN, CF_MEDIA_ZONE_ID: ZONE });
    const store = createObjectStore(serverEnv());
    await store.delete("private", "removed/listings/l1/p-l.webp");
    await store.delete("media", KEYS[0]!);
    expect(added).toEqual([{ name: CDN_PURGE_JOB, data: { keys: [KEYS[0]] }, opts: CDN_JOB_OPTIONS }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
