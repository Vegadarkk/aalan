import { describe, expect, it, vi } from "vitest";
import { CdnPurgeError, CloudflareCdnPurger, createCdnPurger, isCdnPurgeConfigured, mediaPurgeUrls, MemoryCdnPurger, PURGE_BATCH } from "@/lib/cdn";
import { parseEnv } from "@/lib/env";

// CDN purge adapter (audit A4-04): the Cloudflare purge-by-URL client through an injected fetch,
// the factory's choice by environment, the media URLs and the startup checks of its variables.

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger }));
const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/capture", () => ({ captureServerException: capture }));

const { CdnPurgingObjectStore } = await import("@/lib/storage/purging");
const { MemoryObjectStore } = await import("@/lib/storage/memory");

const ZONE = "0123456789abcdef0123456789abcdef";
// Not a real token: the client only forwards it.
const TOKEN = ["fake", "purge", "token"].join("-");
const BASE = "https://media-staging.joutiya.ma";

function answer(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const purger = (fetchImpl: typeof fetch) => new CloudflareCdnPurger({ zoneId: ZONE, token: TOKEN, fetch: fetchImpl });
const urls = (count: number) => Array.from({ length: count }, (_, index) => `${BASE}/listings/l1/p${index}-l.webp`);

describe("CloudflareCdnPurger", () => {
  it("posts the URLs to the zone's purge_cache endpoint with the bearer token", async () => {
    const { impl, calls } = mockFetch(answer({ success: true, errors: [], result: { id: "x" } }));
    await purger(impl).purgeUrls([`${BASE}/listings/l1/p-l.webp`, `${BASE}/listings/l1/p-s.webp`]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ files: [`${BASE}/listings/l1/p-l.webp`, `${BASE}/listings/l1/p-s.webp`] });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends at most 100 URLs per request, without duplicates, and nothing for an empty list", async () => {
    const { impl, calls } = mockFetch(answer({ success: true }), answer({ success: true }));
    await purger(impl).purgeUrls([...urls(PURGE_BATCH + 1), ...urls(3)]);
    expect(calls.map((call) => (JSON.parse(String(call.init.body)) as { files: string[] }).files.length)).toEqual([PURGE_BATCH, 1]);
    await purger(impl).purgeUrls([]);
    expect(calls).toHaveLength(2);
  });

  it("throws with the status and the API error codes, never the token or the messages", async () => {
    const { impl } = mockFetch(answer({ success: false, errors: [{ code: 10000, message: `Authentication error for ${TOKEN}` }] }, 403));
    const error = await purger(impl).purgeUrls(urls(1)).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CdnPurgeError);
    expect(error).toMatchObject({ status: 403, codes: [10000], permanent: false });
    expect((error as Error).message).toBe("CDN purge failed with HTTP 403 (codes 10000)");
  });

  it("fails on a 200 without success, a non-JSON error page, a network error and a timeout", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const { impl } = mockFetch(answer({ success: false, errors: [] }), answer("<html>Bad gateway</html>", 502), new TypeError("fetch failed"), timeout);
    const client = purger(impl);
    await expect(client.purgeUrls(urls(1))).rejects.toMatchObject({ status: 200 });
    await expect(client.purgeUrls(urls(1))).rejects.toMatchObject({ status: 502, codes: [] });
    await expect(client.purgeUrls(urls(1))).rejects.toThrow("CDN purge failed: network error");
    await expect(client.purgeUrls(urls(1))).rejects.toThrow("CDN purge failed: no answer in time");
  });

  it("marks a malformed request (400) as permanent and stops at the first refused batch", async () => {
    const { impl, calls } = mockFetch(answer({ success: false, errors: [{ code: 1012 }] }, 400));
    await expect(purger(impl).purgeUrls(urls(PURGE_BATCH + 5))).rejects.toMatchObject({ permanent: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses anything but absolute https URLs before calling the API", async () => {
    const { impl, calls } = mockFetch();
    await expect(purger(impl).purgeUrls(["http://media.joutiya.ma/a.webp"])).rejects.toBeInstanceOf(CdnPurgeError);
    await expect(purger(impl).purgeUrls(["listings/l1/p-l.webp"])).rejects.toBeInstanceOf(CdnPurgeError);
    expect(calls).toHaveLength(0);
  });

  it("validates its configuration", () => {
    expect(() => new CloudflareCdnPurger({ zoneId: "joutiya.ma", token: TOKEN })).toThrow("32 hexadecimal");
    expect(() => new CloudflareCdnPurger({ zoneId: ZONE, token: "" })).toThrow("empty");
  });
});

describe("factory and URLs", () => {
  const env = { CF_MEDIA_PURGE_TOKEN: TOKEN, CF_MEDIA_ZONE_ID: ZONE, MEDIA_BASE_URL: `${BASE}/` };

  it("purges only with the token, the zone and a media host", () => {
    expect(isCdnPurgeConfigured(env)).toBe(true);
    expect(createCdnPurger(env)?.name).toBe("cloudflare");
    for (const name of ["CF_MEDIA_PURGE_TOKEN", "CF_MEDIA_ZONE_ID", "MEDIA_BASE_URL"] as const) {
      expect(isCdnPurgeConfigured({ ...env, [name]: undefined })).toBe(false);
      expect(createCdnPurger({ ...env, [name]: undefined })).toBeNull();
    }
  });

  it("builds the public URLs on MEDIA_BASE_URL and drops invalid keys", () => {
    expect(mediaPurgeUrls(["listings/l1/p-l.webp", "../escape", "pros/p1/logo-s.webp"], env)).toEqual([`${BASE}/listings/l1/p-l.webp`, `${BASE}/pros/p1/logo-s.webp`]);
    expect(mediaPurgeUrls(["listings/l1/p-l.webp"], { MEDIA_BASE_URL: undefined })).toBeNull();
  });

  it("checks its variables at startup without stopping the app", () => {
    const deployed = parseEnv({ APP_ENV: "staging", SITE_URL: "https://staging.aalan.ma" });
    expect(deployed.warnings).toContain("CF_MEDIA_PURGE_TOKEN is not set: the feature that needs it is unavailable");
    const half = parseEnv({ APP_ENV: "staging", SITE_URL: "https://staging.aalan.ma", CF_MEDIA_ZONE_ID: ZONE });
    expect(half.errors.filter((error) => error.includes("CF_MEDIA"))).toEqual([]);
    expect(half.warnings).toContain("CF_MEDIA_PURGE_TOKEN is not set: the feature that needs it is unavailable");
    const noHost = parseEnv({ APP_ENV: "staging", SITE_URL: "https://staging.aalan.ma", CF_MEDIA_ZONE_ID: ZONE, CF_MEDIA_PURGE_TOKEN: TOKEN });
    expect(noHost.warnings).toContain("CF_MEDIA_PURGE_TOKEN is set without MEDIA_BASE_URL: nothing to purge");
    expect(parseEnv({ CF_MEDIA_ZONE_ID: "not-a-zone" }).errors).toEqual(["CF_MEDIA_ZONE_ID: CF_MEDIA_ZONE_ID must be 32 hexadecimal characters"]);
  });
});

describe("CdnPurgingObjectStore", () => {
  const body = new TextEncoder().encode("webp");

  it("purges a media object after its deletion, and nothing for the other buckets or operations", async () => {
    const inner = new MemoryObjectStore();
    const order: string[] = [];
    const hook = vi.fn(async (key: string) => {
      order.push(`purge ${key} (still stored: ${inner.has("media", key)})`);
    });
    const store = new CdnPurgingObjectStore(inner, hook);
    expect(store.name).toBe(inner.name);
    await store.put("media", "listings/l1/p-l.webp", body, { contentType: "image/webp" });
    await store.put("private", "removed/listings/l1/p-l.webp", body, { contentType: "image/webp" });
    expect(await store.head("media", "listings/l1/p-l.webp")).toEqual({ size: 4, contentType: "image/webp" });
    expect(await store.get("media", "listings/l1/p-l.webp")).not.toBeNull();
    await store.delete("private", "removed/listings/l1/p-l.webp");
    await store.delete("quarantine", "uploads/u1");
    expect(hook).not.toHaveBeenCalled();
    await store.delete("media", "listings/l1/p-l.webp");
    expect(order).toEqual(["purge listings/l1/p-l.webp (still stored: false)"]);
  });

  it("keeps the deletion when the purge cannot be requested: logged and reported, not thrown", async () => {
    const inner = new MemoryObjectStore();
    const store = new CdnPurgingObjectStore(inner, async () => {
      throw new Error("Valkey unreachable");
    });
    inner.seed("media", "listings/l1/p-s.webp", body, { contentType: "image/webp" });
    await expect(store.delete("media", "listings/l1/p-s.webp")).resolves.toBeUndefined();
    expect(inner.has("media", "listings/l1/p-s.webp")).toBe(false);
    expect(logger.error).toHaveBeenCalledWith({ key: "listings/l1/p-s.webp", err: "Valkey unreachable" }, "deleted media not purged from the CDN");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("does not purge when the deletion itself fails (the caller retries it)", async () => {
    const hook = vi.fn(async () => undefined);
    const failing = Object.assign(new MemoryObjectStore(), { delete: async () => Promise.reject(new Error("R2 503")) });
    await expect(new CdnPurgingObjectStore(failing, hook).delete("media", "listings/l1/p-l.webp")).rejects.toThrow("R2 503");
    expect(hook).not.toHaveBeenCalled();
  });

  it("serves as the memory purger's double too", async () => {
    const memory = new MemoryCdnPurger();
    memory.failNext = 1;
    await expect(memory.purgeUrls(urls(1))).rejects.toMatchObject({ status: 503 });
    await memory.purgeUrls(urls(2));
    expect(memory.purged).toEqual(urls(2));
  });
});
