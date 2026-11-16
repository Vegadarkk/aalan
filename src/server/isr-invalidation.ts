// ISR invalidation across processes. Each Next.js server keeps its ISR pages in its own memory
// (isrFlushToDisk off) and revalidatePath reaches only the process that ran it, none at all from
// the worker. So every invalidation of a public page is also published on the valkey-queue
// channel ISR_CHANNEL (src/lib/listings/revalidate.ts, best effort, nothing stored), and each web
// process subscribes at start (src/server/web-cluster.ts): it marks the pages' implicit cache tags
// expired in Next's own tag manifest, exactly as its revalidatePath would, so its next request
// renders the page again (a removed listing: 404) instead of serving its copy. A message missed
// while a process was disconnected is bounded by `expireTime` (next.config.ts).
// Self-contained (no "server-only", no app imports): bundled into dist/server/web-cluster.mjs.

export const ISR_CHANNEL = "isr:expire";
/** Paths per message: a listing change names 9 at most (3 locales of listing, profile, storefront). */
export const ISR_MESSAGE_MAX_PATHS = 60;
/** Next's implicit tag prefix (next/dist/lib/constants: NEXT_CACHE_IMPLICIT_TAG_ID). */
export const IMPLICIT_TAG_PREFIX = "_N_T_";
/** The tag manifest of the installed Next runtime (the module its file-system cache reads). */
export const TAGS_MANIFEST_MODULE = "next/dist/server/lib/incremental-cache/tags-manifest.external.js";

/** Public page paths only: a locale, a page kind, one segment of URL-safe characters. */
const PAGE_PATH = /^\/(?:fr|ar|rif)\/(?:annonce|profil|boutique)\/[A-Za-z0-9._~%-]{1,200}$/;

export function isInvalidatablePath(path: unknown): path is string {
  return typeof path === "string" && PAGE_PATH.test(path);
}

/** The implicit tag revalidatePath(path) expires (next/dist/server/web/spec-extension/revalidate.js). */
export function implicitTag(path: string): string {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  // encodeHeaderSafe: runs outside tab and printable ASCII are percent-encoded.
  const safe = /[^\t\x20-\x7e]/.test(trimmed) ? trimmed.replace(/[^\t\x20-\x7e]+/g, (run) => encodeURIComponent(run)) : trimmed;
  return `${IMPLICIT_TAG_PREFIX}${safe}`;
}

export function encodeMessage(paths: readonly string[]): string {
  return JSON.stringify({ paths: paths.filter(isInvalidatablePath).slice(0, ISR_MESSAGE_MAX_PATHS) });
}

/** The valid paths of a channel message; anything malformed gives none. */
export function decodeMessage(message: string): string[] {
  try {
    const parsed: unknown = JSON.parse(message);
    const paths = typeof parsed === "object" && parsed !== null ? (parsed as { paths?: unknown }).paths : undefined;
    return Array.isArray(paths) ? paths.slice(0, ISR_MESSAGE_MAX_PATHS).filter(isInvalidatablePath) : [];
  } catch {
    return [];
  }
}

export interface TagEntry {
  stale?: number;
  expired?: number;
}

export type TagsManifest = Map<string, TagEntry>;

/** Marks the pages' tags expired at `now`, as FileSystemCache.revalidateTag does without durations. */
export function expirePaths(manifest: TagsManifest, paths: readonly string[], now = Date.now()): number {
  let count = 0;
  for (const path of paths) {
    if (!isInvalidatablePath(path)) continue;
    const tag = implicitTag(path);
    manifest.set(tag, { ...manifest.get(tag), expired: now });
    count += 1;
  }
  return count;
}

/** The manifest of a loaded Next runtime module, or null when its shape is not the expected one. */
export function manifestOf(module: unknown): TagsManifest | null {
  const manifest = typeof module === "object" && module !== null ? (module as { tagsManifest?: unknown }).tagsManifest : undefined;
  return manifest instanceof Map ? (manifest as TagsManifest) : null;
}

export interface Subscriber {
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  subscribe(channel: string): Promise<unknown>;
}

/** Subscribes `subscriber` to the channel and expires the paths of each message in `manifest`. */
export async function listen(subscriber: Subscriber, manifest: TagsManifest, log: (message: string, fields?: Record<string, unknown>) => void): Promise<void> {
  subscriber.on("message", (channel, message) => {
    if (channel !== ISR_CHANNEL) return;
    expirePaths(manifest, decodeMessage(message));
  });
  // ioredis reconnects and subscribes again by itself; an error is logged (once a minute), never thrown.
  let lastLog = -Infinity;
  subscriber.on("error", (error) => {
    const now = Date.now();
    if (now - lastLog < 60_000) return;
    lastLog = now;
    log("ISR invalidation channel error", { err: error.message });
  });
  await subscriber.subscribe(ISR_CHANNEL);
}
