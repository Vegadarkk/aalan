import "server-only";
import { revalidatePath } from "next/cache";
import { LOCALES } from "@/config/site";
import { cdnPurger } from "@/lib/cdn";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logging/logger";
import { isValkeyConfigured, valkey } from "@/lib/valkey/clients";
import { encodeMessage, ISR_CHANNEL } from "@/server/isr-invalidation";

// ISR invalidation of the public listing, profile and storefront pages (design §4): every locale
// of /annonce/{slugId}, /profil/{publicId} and /boutique/{slug}-{proId}, in three places:
// - this process: revalidatePath (outside a Next request context, the worker or unit tests, it
//   throws, which is logged at debug and swallowed);
// - every web process: the paths are published on the valkey-queue ISR channel, which each server
//   process hears (src/server/isr-invalidation.ts), the worker's changes included;
// - the Cloudflare edge (production): the page URLs are purged, so a removed listing's copy cached
//   there is not served until its s-maxage ends. Both are best effort and never throw.

export interface RevalidateListingInput {
  /** The listing's URL segment, "{slug}-{id}". */
  slugId?: string;
  /** The seller's public profile id. */
  publicId?: string;
  /** A shop's storefront segment, "{slug}-{proId}". */
  shopSegment?: string;
}

export function listingPagePaths(slugId: string): string[] {
  return LOCALES.map((locale) => `/${locale}/annonce/${slugId}`);
}

export function profilePagePaths(publicId: string): string[] {
  return LOCALES.map((locale) => `/${locale}/profil/${publicId}`);
}

export function storefrontPagePaths(shopSegment: string): string[] {
  return LOCALES.map((locale) => `/${locale}/boutique/${shopSegment}`);
}

/** Paths to revalidate for the given ids (any may be omitted). */
export function listingRevalidationPaths({ slugId, publicId, shopSegment }: RevalidateListingInput): string[] {
  return [...(slugId ? listingPagePaths(slugId) : []), ...(publicId ? profilePagePaths(publicId) : []), ...(shopSegment ? storefrontPagePaths(shopSegment) : [])];
}

/** A slow Valkey must not hold the change that invalidates. */
const PUBLISH_TIMEOUT_MS = 800;
/** Page URLs purged together: one request for the changes of this window. */
const PURGE_DEBOUNCE_MS = 1_000;

export type PathsPublisher = (paths: readonly string[]) => Promise<void>;
export type PagePurger = (urls: readonly string[]) => Promise<void>;

let publisherForTests: PathsPublisher | null | undefined;
let purgerForTests: PagePurger | null | undefined;

/** Tests: the channel publisher and the edge purger (null: off; undefined: the configured ones). */
export function setRevalidationSinksForTests(sinks: { publish?: PathsPublisher | null; purge?: PagePurger | null } | undefined): void {
  publisherForTests = sinks?.publish;
  purgerForTests = sinks?.purge;
}

async function valkeyPublish(paths: readonly string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("valkey timeout")), PUBLISH_TIMEOUT_MS);
  });
  await Promise.race([valkey("queue").publish(ISR_CHANNEL, encodeMessage(paths)), timeout]).finally(() => clearTimeout(timer));
}

function publisher(): PathsPublisher | null {
  if (publisherForTests !== undefined) return publisherForTests;
  return isValkeyConfigured("queue") ? valkeyPublish : null;
}

function pagePurger(): PagePurger | null {
  if (purgerForTests !== undefined) return purgerForTests;
  // Only production pages are cached at the edge (infra/cloudflare/cache-rules.json).
  if (serverEnv().APP_ENV !== "prod") return null;
  const purger = cdnPurger();
  return purger ? (urls) => purger.purgeUrls(urls) : null;
}

const pendingPurge = new Set<string>();
let purgeTimer: ReturnType<typeof setTimeout> | null = null;

async function flushPurge(purge: PagePurger): Promise<void> {
  purgeTimer = null;
  const urls = [...pendingPurge];
  pendingPurge.clear();
  try {
    await purge(urls);
  } catch (error) {
    logger.warn({ err: (error as Error).message, urls: urls.length }, "edge purge of public pages failed");
  }
}

function schedulePurge(paths: readonly string[]): void {
  const purge = pagePurger();
  if (!purge) return;
  const base = serverEnv().SITE_URL.replace(/\/+$/, "");
  for (const path of paths) pendingPurge.add(`${base}${path}`);
  if (purgeTimer) return;
  purgeTimer = setTimeout(() => void flushPurge(purge), PURGE_DEBOUNCE_MS);
  purgeTimer.unref?.();
}

/** Tests: purges what is waiting now. */
export async function flushPagePurgeForTests(): Promise<void> {
  if (purgeTimer) clearTimeout(purgeTimer);
  const purge = pagePurger();
  if (purge && pendingPurge.size > 0) await flushPurge(purge);
}

/** Revalidates every path of `listingRevalidationPaths` here, in every web process and at the edge; returns the paths. */
export function revalidateListingPaths(input: RevalidateListingInput): string[] {
  const paths = listingRevalidationPaths(input);
  if (paths.length === 0) return paths;
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error) {
      logger.debug({ path, err: (error as Error).message }, "revalidatePath skipped (no request context)");
    }
  }
  const publish = publisher();
  if (publish) {
    publish(paths).catch((error: unknown) => logger.warn({ err: (error as Error).message, paths: paths.length }, "ISR invalidation not published"));
  }
  schedulePurge(paths);
  return paths;
}
