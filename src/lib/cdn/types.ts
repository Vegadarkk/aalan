import "server-only";

// CDN cache purge adapter (CLAUDE.md "Adapters"; audit A4-04): a deleted or moved photo answers
// 404 at R2 at once, but the edge may keep serving a copy cached before, for a day at most
// (infra/cloudflare/cache-rules.json; MEDIA_CACHE_CONTROL is a day too, a year on objects stored
// before 2026-11-04). Implementations: cloudflare.ts (zone purge API by
// URL), memory.ts (tests). Browser caches cannot be purged by anyone: only the edge is.

export interface CdnPurger {
  readonly name: string;
  /** Drops every URL from the edge cache; throws CdnPurgeError when any batch is refused. */
  purgeUrls(urls: readonly string[]): Promise<void>;
}

/** A purge request refused or not answered: HTTP status (0 when no answer) and API error codes, never the token. */
export class CdnPurgeError extends Error {
  readonly status: number;
  readonly codes: readonly number[];

  constructor(status: number, codes: readonly number[] = [], reason?: string) {
    super(`CDN purge failed${status ? ` with HTTP ${status}` : ""}${codes.length ? ` (codes ${codes.join(", ")})` : ""}${reason ? `: ${reason}` : ""}`);
    this.name = "CdnPurgeError";
    this.status = status;
    this.codes = codes;
  }

  /** A malformed request (400): retrying the same URLs cannot succeed. */
  get permanent(): boolean {
    return this.status === 400;
  }
}
