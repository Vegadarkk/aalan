// The heart an anonymous visitor clicked (audit zone 5 n°8, synthesis §5 "favori posé
// automatiquement"): the sign-in link carries it in the fragment of `next` (never sent to the
// server), and the heart of that listing adds it by itself once the session is known. Add only,
// never a removal; taken once, then dropped from the address bar so a reload does nothing. The
// fragment alone is not a click: anyone can write that link, so the click also leaves a short-lived
// marker in this browser, and only a fragment matching it is replayed.

import { isListingId } from "@/lib/listings/ids";

/** Fragment key of the listing to add to the favorites after sign-in. */
export const FAVORITE_FRAGMENT_KEY = "favori";

/** localStorage key of the click marker (survives the sign-in pages and a verification tab). */
export const PENDING_CLICK_KEY = "aalan:pending-favorite";
/** A click older than this is not replayed: sign-in or sign-up and verification fit in it. */
export const PENDING_CLICK_MAX_AGE_MS = 60 * 60_000;

/** Records the click on the heart of `listingId` before leaving for sign-in. */
export function rememberPendingFavorite(listingId: string, now = Date.now()): void {
  try {
    window.localStorage.setItem(PENDING_CLICK_KEY, JSON.stringify({ id: listingId, at: now }));
  } catch {
    // Storage blocked: the heart is simply not added after sign-in.
  }
}

/** True when this browser clicked the heart of `listingId` recently; the marker is used up. */
function takeClickMarker(listingId: string, now: number): boolean {
  try {
    const raw = window.localStorage.getItem(PENDING_CLICK_KEY);
    const marker = raw ? (JSON.parse(raw) as { id?: unknown; at?: unknown }) : null;
    if (!marker || marker.id !== listingId) return false;
    window.localStorage.removeItem(PENDING_CLICK_KEY);
    return typeof marker.at === "number" && now - marker.at >= 0 && now - marker.at < PENDING_CLICK_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** `hash` with the pending favorite set (other fragment keys, e.g. rental days, are kept). */
export function favoriteFragment(hash: string, listingId: string): string {
  const query = new URLSearchParams(hash.replace(/^#/, ""));
  query.set(FAVORITE_FRAGMENT_KEY, listingId);
  return `#${query.toString()}`;
}

/** The listing id waiting in the fragment, or null (a malformed value is ignored). */
export function pendingFavorite(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get(FAVORITE_FRAGMENT_KEY);
  return value && isListingId(value) ? value : null;
}

/** `hash` without the pending favorite ("" when nothing else is left). */
export function withoutPendingFavorite(hash: string): string {
  const query = new URLSearchParams(hash.replace(/^#/, ""));
  query.delete(FAVORITE_FRAGMENT_KEY);
  const rest = query.toString();
  return rest ? `#${rest}` : "";
}

/**
 * True once for the heart of the listing named in the fragment, when this browser's click marker
 * names it too: the key leaves the address bar at once (marker or not), so a second heart of the
 * same listing on the page (card and map panel) does not add it twice.
 */
export function takePendingFavorite(listingId: string, now = Date.now()): boolean {
  const { pathname, search, hash } = window.location;
  if (pendingFavorite(hash) !== listingId) return false;
  window.history.replaceState(window.history.state, "", `${pathname}${search}${withoutPendingFavorite(hash)}`);
  return takeClickMarker(listingId, now);
}
