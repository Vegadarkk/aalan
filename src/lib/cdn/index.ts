import "server-only";
import { serverEnv, type ServerEnv } from "@/lib/env";
import { isValidObjectKey } from "@/lib/storage/keys";
import { CloudflareCdnPurger } from "./cloudflare";
import type { CdnPurger } from "./types";

// Factory of the CDN purge adapter: Cloudflare when CF_MEDIA_PURGE_TOKEN and CF_MEDIA_ZONE_ID are
// set (both or none, src/lib/env.ts), else none (dev, tests, an environment whose token is not in
// place yet: deletions still happen, the edge keeps its copies until they expire).

export { CloudflareCdnPurger, PURGE_BATCH } from "./cloudflare";
export { MemoryCdnPurger } from "./memory";
export { CdnPurgeError, type CdnPurger } from "./types";

type PurgeEnv = Pick<ServerEnv, "CF_MEDIA_PURGE_TOKEN" | "CF_MEDIA_ZONE_ID" | "MEDIA_BASE_URL">;

/** Both purge variables and a public media host: deleted photos can be dropped from the edge. */
export function isCdnPurgeConfigured(env: PurgeEnv = serverEnv()): boolean {
  return Boolean(env.CF_MEDIA_PURGE_TOKEN && env.CF_MEDIA_ZONE_ID && env.MEDIA_BASE_URL);
}

export function createCdnPurger(env: PurgeEnv): CdnPurger | null {
  if (!isCdnPurgeConfigured(env)) return null;
  return new CloudflareCdnPurger({ zoneId: env.CF_MEDIA_ZONE_ID!, token: env.CF_MEDIA_PURGE_TOKEN! });
}

let shared: CdnPurger | null | undefined;

/** The process-wide purger, or null when purging is not configured. */
export function cdnPurger(): CdnPurger | null {
  if (shared === undefined) shared = createCdnPurger(serverEnv());
  return shared;
}

/** Tests only: serve `purger` from cdnPurger() (undefined reads the environment again). */
export function setCdnPurgerForTests(purger: CdnPurger | null | undefined): void {
  shared = purger;
}

/**
 * Public URLs of media bucket keys on MEDIA_BASE_URL (the host the edge caches; the dev storage
 * route is never cached), or null without one. Keys failing the object key check are left out.
 */
export function mediaPurgeUrls(keys: readonly string[], env: Pick<ServerEnv, "MEDIA_BASE_URL"> = serverEnv()): string[] | null {
  if (!env.MEDIA_BASE_URL) return null;
  const base = env.MEDIA_BASE_URL.replace(/\/+$/, "");
  return keys.filter(isValidObjectKey).map((key) => `${base}/${key}`);
}
