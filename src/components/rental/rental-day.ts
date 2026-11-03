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
