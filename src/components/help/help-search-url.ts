// The /aide search in the address (audit zone 5 n°19), so a search can be shared or kept: in the
// fragment, `/aide#q=annonce+expirée`. A query string would bypass the edge cache of this ISR page,
// and the proxy sends `/aide?…` to the clean path (audit D-5); a fragment never reaches the server.
// Pure helpers, used by help-search.tsx.

export const HELP_QUERY_MAX = 100;

/** The search held by a location hash ("#q=..."), "" when there is none. */
export function queryFromHash(hash: string): string {
  if (!hash.startsWith("#q=")) return "";
  try {
    return (new URLSearchParams(hash.slice(1)).get("q") ?? "").slice(0, HELP_QUERY_MAX);
  } catch {
    return "";
  }
}

/** The hash for `query`: "#q=..." while something is typed, "" to clear it. Other hashes stay. */
export function hashForQuery(query: string, currentHash: string): string {
  const trimmed = query.trim().slice(0, HELP_QUERY_MAX);
  if (!trimmed) return currentHash.startsWith("#q=") ? "" : currentHash;
  return `#${new URLSearchParams({ q: trimmed }).toString()}`;
}
