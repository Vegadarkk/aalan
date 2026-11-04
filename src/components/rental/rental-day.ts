import type { Locale } from "@/config/site";
import { intlLocale } from "@/lib/listings/client/format";

// Car rental days in the UI (rental pack §6), zod-free for the listing page's islands: a short day
// label, and the searched days carried from a results card to the listing page's booking request
// in the URL fragment (the edge cache and the server never see it). The fragment uses the names of
// SEARCH_QUERY_KEYS.rentFrom and rentTo (search/params.ts, not imported here: it pulls zod).

/** "jeu. 5 nov." of a "YYYY-MM-DD" day. */
export function formatRentalDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

/** "5 nov." of a "YYYY-MM-DD" day (a narrow field). */
export function formatShortDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

/** `#du=…&au=…` of the searched days. */
export function rentalFragment(dates: { from: string; to: string }): string {
  return `#du=${dates.from}&au=${dates.to}`;
}

/** The days of a listing URL's fragment, unchecked; null when absent. */
export function fragmentDates(hash: string): { from: string; to: string } | null {
  const query = new URLSearchParams(hash.replace(/^#/, ""));
  const from = query.get("du");
  const to = query.get("au");
  return from && to ? { from, to } : null;
}

/** Fragment key of the contact the visitor started before signing in (audit L4-03, zone 5 n°8). */
export const CONTACT_FRAGMENT_KEY = "contact";

/**
 * The fragment a sign-in link sends back to: the action the visitor chose (a message, the dates of
 * a rental, a visit, an offer) and the days already picked, so the listing page reopens that dialog
 * on them once signed in instead of starting over.
 */
export function contactFragment(hash: string, intent: string): string {
  const dates = fragmentDates(hash);
  const query = new URLSearchParams();
  if (dates) {
    query.set("du", dates.from);
    query.set("au", dates.to);
  }
  query.set(CONTACT_FRAGMENT_KEY, intent);
  return `#${query.toString()}`;
}

/** The contact to reopen, read from the fragment; null when there is none. */
export function pendingContact(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get(CONTACT_FRAGMENT_KEY) || null;
}

/** Drops the contact key from the address bar (the days stay): reopened once, not on every reload. */
export function clearPendingContact(): void {
  const { pathname, search, hash } = window.location;
  const dates = fragmentDates(hash);
  window.history.replaceState(window.history.state, "", `${pathname}${search}${dates ? rentalFragment(dates) : ""}`);
}

/**
 * Keeps the days picked on the listing page's calendar in the fragment without opening anything
 * (audit L4-05): the side button « Demander une réservation » then opens the dialog on them too.
 * null takes them out.
 */
export function rememberRentalDates(dates: { from: string; to: string } | null): void {
  const { pathname, search, hash } = window.location;
  const contact = pendingContact(hash);
  const query = new URLSearchParams();
  if (dates) {
    query.set("du", dates.from);
    query.set("au", dates.to);
  }
  if (contact) query.set(CONTACT_FRAGMENT_KEY, contact);
  const fragment = query.toString();
  window.history.replaceState(window.history.state, "", `${pathname}${search}${fragment ? `#${fragment}` : ""}`);
}

/** Window event of the listing page: its calendar asks the contact bar for a request on these days. */
export const RENTAL_DATES_EVENT = "aalan:rental-dates";

/**
 * The days picked on the listing page's calendar: into the fragment, where the request dialog reads
 * them, then the contact bar opens that dialog (it listens for RENTAL_DATES_EVENT).
 */
export function requestRentalDates(dates: { from: string; to: string }): void {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}${rentalFragment(dates)}`);
  window.dispatchEvent(new CustomEvent(RENTAL_DATES_EVENT, { detail: dates }));
}
