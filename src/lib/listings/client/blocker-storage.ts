import type { FieldIssue } from "@/lib/contracts/listings";

// The server's blockers of one listing (a refused publication, or a renewal refused with 422 in
// "Mes annonces"), kept per tab (sessionStorage) until they are settled: the review step lists them
// again after a reload, and the steps behind « Corriger » show their reason (zone 3 P2-9). The
// wizard store writes them on every change; an empty list removes the entry. Storage can be
// unavailable (private window, blocked site data): the blockers then live in memory only.

const MAX_ISSUES = 50;
const key = (listingId: string) => `aalan:blockers:${listingId}`;

function isIssue(value: unknown): value is FieldIssue {
  if (!value || typeof value !== "object") return false;
  const issue = value as Record<string, unknown>;
  return typeof issue["path"] === "string" && typeof issue["code"] === "string" && (issue["message"] === undefined || typeof issue["message"] === "string");
}

/** Keeps the listing's blockers for this tab; [] forgets them. */
export function stashBlockers(listingId: string, blockers: readonly FieldIssue[]): void {
  try {
    if (blockers.length === 0) sessionStorage.removeItem(key(listingId));
    else sessionStorage.setItem(key(listingId), JSON.stringify(blockers.slice(0, MAX_ISSUES)));
  } catch {
    // Storage unavailable: in memory only.
  }
}

/** The blockers kept for this listing; [] when none (or unreadable). */
export function readBlockers(listingId: string): FieldIssue[] {
  try {
    const raw = sessionStorage.getItem(key(listingId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isIssue).slice(0, MAX_ISSUES) : [];
  } catch {
    return [];
  }
}
