"use client";

import { useState } from "react";
import { CalendarDays, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useHydrated } from "@/components/auth/use-hydrated";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { RentalUnit } from "@/config/categories";
import type { Locale } from "@/config/site";
import type { RentalAvailability } from "@/lib/contracts/listings";
import { formatDate, formatPrice } from "@/lib/listings/client/format";
import { RENTAL_AHEAD_DAYS, RENTAL_SEARCH_AHEAD_DAYS, RENTAL_SEARCH_DAYS_MAX, blockedSet, dayNumber, dayString, isFresh, moroccoToday, occupiedDays, rentalDayRate, rentalDuration } from "@/lib/listings/rental-availability";
import { cn } from "@/lib/utils";
import { AvailabilityCalendar } from "./availability-calendar";
import { formatRentalDay, fragmentDates, rememberRentalDates, requestRentalDates } from "./rental-day";

// The listing page's availability block (rental pack §3; a holiday home: seasonal rental conception
// §2, its nights): this month and the next, as declared by the agency or the host. The page is cached (ISR), so the days are drawn in the browser, on today's date.
// With `requestable` (the contact bar offers a booking request), a tap on a day starts the period
// and a second tap ends it; "Demander ces dates" opens the request on them (owner's report of
// 3 Nov 2026: the calendar looked like a picker and did nothing on a tablet). The same bounds as
// the request itself: a start within 180 days, at most 60 days, one night at least for a stay. An
// example listing (never contactable) picks days the same way and says no request can go (the
// owner tried the calendar on the staging examples: 3 Nov 2026).

interface Range {
  from: number;
  to: number | null;
}

/** The days of a `#du=…&au=…` fragment as day numbers; null when absent or not real days. */
function addressRange(hash: string): Range | null {
  const dates = fragmentDates(hash);
  if (!dates) return null;
  const from = dayNumber(dates.from);
  const to = dayNumber(dates.to);
  return Number.isNaN(from) || Number.isNaN(to) ? null : { from, to };
}

/** The bounds of a tap (onDay): a start within the request's horizon, at most the search's length. */
function withinBounds(range: Range, today: number, gap: number): boolean {
  return range.to !== null && range.from >= today && range.from <= today + RENTAL_SEARCH_AHEAD_DAYS && range.to >= range.from + gap && range.to - range.from <= RENTAL_SEARCH_DAYS_MAX;
}

/** The listing's prices for the estimate of a picked period (audit L4-19): the day or night price and a car's long-term rates. */
export interface RentalRates {
  price: number;
  week?: number;
  month?: number;
}

/** The estimated total of `count` days or nights, as the results cards compute it. */
export function rentalEstimate(rates: RentalRates, count: number): number {
  const attributes: Record<string, number> = {};
  if (rates.week) attributes["rate-7-days"] = rates.week;
  if (rates.month) attributes["rate-30-days"] = rates.month;
  return rentalDayRate(attributes, rates.price, count) * count;
}

export function ListingAvailability({
  rental,
  locale,
  unit = "day",
  requestable = false,
  example = false,
  rates,
}: {
  rental: RentalAvailability;
  locale: Locale;
  unit?: RentalUnit;
  requestable?: boolean;
  example?: boolean;
  rates?: RentalRates;
}) {
  const t = useTranslations("Rental.listing");
  const hydrated = useHydrated();
  const [monthOffset, setMonthOffset] = useState(0);
  const [picked, setRange] = useState<Range | null>(null);
  // The days of the address (a search by dates, or back from the sign-in page: audit L4-03) start
  // picked. Read in the browser only and used once hydrated (the server renders a skeleton).
  const [fromAddress] = useState<Range | null>(() => (typeof window === "undefined" ? null : addressRange(window.location.hash)));
  // Server and hydration render a skeleton; the browser's clock then draws the days.
  const [clock] = useState(() => Date.now());
  const now = hydrated ? clock : null;
  const fresh = now !== null && isFresh(rental.updatedAt ? Date.parse(rental.updatedAt) : null, now);
  const today = now === null ? 0 : moroccoToday(now);
  const nights = unit === "night";
  const gap = nights ? 1 : 0;
  const range = picked ?? (now !== null && (requestable || example) && fromAddress && withinBounds(fromAddress, today, gap) ? fromAddress : null);
  const blocked = blockedSet(rental.unavailable);
  const text = <K extends "updatedOn" | "stale" | "never" | "note" | "pickHint" | "pickEnd" | "picked" | "pickedBlocked" | "estimate">(key: K) => (nights ? (`home.${key}` as const) : key);
  const dates = range && range.to !== null ? { from: dayString(range.from), to: dayString(range.to) } : null;
  const selectable = requestable || example;
  const crossesBlocked = dates !== null && occupiedDays(dates, unit).some((day) => blocked.has(day));

  function onDay(day: number) {
    if (range && range.to === null && day >= range.from + gap && day - range.from <= RENTAL_SEARCH_DAYS_MAX) {
      setRange({ from: range.from, to: day });
      // The side button's dialog takes these days too (audit L4-05).
      if (requestable) rememberRentalDates({ from: dayString(range.from), to: dayString(day) });
      return;
    }
    // A new start: within the request's horizon only.
    setRange(day <= today + RENTAL_SEARCH_AHEAD_DAYS ? { from: day, to: null } : null);
    if (requestable && range && range.to !== null) rememberRentalDates(null);
  }

  return (
    <section data-testid="rental-availability" aria-labelledby="rental-availability-title" className="flex flex-col gap-4">
      <h2 id="rental-availability-title" className="flex items-center gap-2 text-lg font-semibold">
        <CalendarDays aria-hidden="true" className="size-5 text-structure" />
        {t("title")}
      </h2>
      {now === null ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <p className={cn("text-sm text-pretty", fresh ? "text-foreground-muted" : "font-medium text-warning")} data-testid="rental-availability-freshness">
            {rental.updatedAt ? t(text(fresh ? "updatedOn" : "stale"), { date: formatDate(new Date(rental.updatedAt), locale) }) : t(text("never"))}
          </p>
          <AvailabilityCalendar
            locale={locale}
            today={today}
            lastDay={today + RENTAL_AHEAD_DAYS - 1}
            blocked={blocked}
            monthOffset={monthOffset}
            months={2}
            onMonthOffset={setMonthOffset}
            maxMonthOffset={10}
            {...(selectable ? { onDay, range, lastEditable: today + RENTAL_SEARCH_AHEAD_DAYS + RENTAL_SEARCH_DAYS_MAX } : {})}
          />
          {selectable ? (
            <div className="flex flex-col gap-3 rounded-md bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="rental-availability-pick">
              <div className="flex min-w-0 flex-col gap-1">
                <p role="status" className="text-sm font-medium text-pretty">
                  {dates
                    ? t(text("picked"), { from: formatRentalDay(dates.from, locale), to: formatRentalDay(dates.to, locale), count: rentalDuration(dates) })
                    : t(text(range ? "pickEnd" : "pickHint"))}
                </p>
                {dates && rates ? (
                  <p className="text-sm text-foreground-muted tabular-nums" data-testid="rental-availability-estimate">
                    {t(text("estimate"), { total: formatPrice(rentalEstimate(rates, rentalDuration(dates)), locale), count: rentalDuration(dates) })}
                  </p>
                ) : null}
                {crossesBlocked ? <p className="text-xs text-warning text-pretty">{t(text("pickedBlocked"))}</p> : null}
              </div>
              {range ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRange(null);
                      if (requestable) rememberRentalDates(null);
                    }}
                  >
                    {t("clear")}
                  </Button>
                  {dates && !requestable ? <p className="self-center text-xs text-foreground-muted">{t("exampleNoRequest")}</p> : null}
                  {dates && requestable ? (
                    <Button type="button" variant="structure" size="sm" data-testid="rental-availability-request" onClick={() => requestRentalDates(dates)}>
                      <Send aria-hidden="true" />
                      {t("request")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      <p className="text-xs text-foreground-muted text-pretty">{t(text("note"))}</p>
    </section>
  );
}
