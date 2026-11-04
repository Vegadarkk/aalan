// The heart an anonymous visitor clicked (audit zone 5 n°8, synthesis §5 "favori posé
// automatiquement"): the sign-in link carries it in the fragment of `next` (never sent to the
// server), and the heart of that listing adds it by itself once the session is known. Add only,
// never a removal; taken once, then dropped from the address bar so a reload does nothing.

import { isListingId } from "@/lib/listings/ids";

/** Fragment key of the listing to add to the favorites after sign-in. */
export const FAVORITE_FRAGMENT_KEY = "favori";

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
 * True once for the heart of the listing named in the fragment: the key leaves the address bar at
 * once, so a second heart of the same listing on the page (card and map panel) does not add it twice.
 */
export function takePendingFavorite(listingId: string): boolean {
  const { pathname, search, hash } = window.location;
  if (pendingFavorite(hash) !== listingId) return false;
  window.history.replaceState(window.history.state, "", `${pathname}${search}${withoutPendingFavorite(hash)}`);
  return true;
}
