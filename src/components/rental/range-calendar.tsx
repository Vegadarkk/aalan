"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Direction } from "radix-ui";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/config/site";
import { intlLocale } from "@/lib/listings/client/format";
import { dayString } from "@/lib/listings/rental-availability";
import { cn } from "@/lib/utils";
import { monthStart, monthWeeks, monthsBetween, weekdayIndex } from "./calendar-grid";

// One month of days to pick a rental period from (the date fields' calendar): plain buttons, so a
// tap, a click or Enter picks a day the same way on a tablet, a phone or a computer (iPadOS Safari
// would not let the owner pick dates in the native fields; report of 3 Nov 2026). Keyboard as the
// WAI-ARIA date picker grid: arrows move by a day or a week (mirrored right to left), Home and End
// to the week's ends, Page Up and Page Down by a month. Disabled days stay focusable (aria-disabled).

export interface RangeCalendarProps {
  locale: Locale;
  /** Today in Morocco (day number). */
  today: number;
  /** The chosen period (an end before the start is not drawn). */
  from: number | null;
  to: number | null;
  /** Days a tap can pick. */
  isEnabled: (day: number) => boolean;
  /** While the end is chosen: days from this one on preview the period under the pointer or the focus. */
  previewFrom?: number | null;
  /** Day focused (and month shown) at first. */
  initialFocus: number;
  /** First and last days the months reach. */
  firstDay: number;
  lastDay: number;
  onPick: (day: number) => void;
  /** Names of the period's ends, read after an end day's date. */
  fromLabel: string;
  toLabel: string;
  /** The grid takes the focus when it mounts (the popover just opened). */
  autoFocus?: boolean;
}

export function RangeCalendar({ locale, today, from, to, isEnabled, previewFrom = null, initialFocus, firstDay, lastDay, onPick, fromLabel, toLabel, autoFocus = false }: RangeCalendarProps) {
  const t = useTranslations("Rental.calendar");
  const rtl = Direction.useDirection() === "rtl";
  const tag = intlLocale(locale);
  const monthFormat = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdayFormat = new Intl.DateTimeFormat(tag, { weekday: "narrow", timeZone: "UTC" });
  const weekdayLong = new Intl.DateTimeFormat(tag, { weekday: "long", timeZone: "UTC" });
  const dayFormat = new Intl.DateTimeFormat(tag, { day: "numeric", timeZone: "UTC" });
  const fullFormat = new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const clamp = (day: number) => Math.min(Math.max(day, firstDay), lastDay);
  const [focused, setFocused] = useState(() => clamp(initialFocus));
  const [hovered, setHovered] = useState<number | null>(null);
  /** The keys moved the focus: the focused day previews the end (a tap does not). */
  const [keyed, setKeyed] = useState(false);
  const moveFocus = useRef(autoFocus);
  const grid = useRef<HTMLTableElement>(null);
  const view = monthStart(focused);
  const canPrevious = monthsBetween(firstDay, view) > 0;
  const canNext = monthsBetween(view, lastDay) > 0;
  // A known Monday (1970-01-05) gives the weekday headers in the page's language.
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date((4 + index) * 86_400_000));

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${dayString(focused)}"]`)?.focus();
  }, [focused]);

  /** The same day of the month `offset` months away (the month's last day when shorter). */
  function shiftMonth(day: number, offset: number): number {
    const target = monthStart(day, offset);
    const length = monthStart(target, 1) - target;
    return target + Math.min(day - monthStart(day), length - 1);
  }

  function go(day: number, keyboard: boolean) {
    moveFocus.current = keyboard;
    setFocused(clamp(day));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const step = rtl ? -1 : 1;
    const moves: Record<string, () => number> = {
      ArrowRight: () => focused + step,
      ArrowLeft: () => focused - step,
      ArrowDown: () => focused + 7,
      ArrowUp: () => focused - 7,
      Home: () => focused - weekdayIndex(focused),
      End: () => focused + 6 - weekdayIndex(focused),
      PageDown: () => shiftMonth(focused, event.shiftKey ? 12 : 1),
      PageUp: () => shiftMonth(focused, event.shiftKey ? -12 : -1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setKeyed(true);
    go(move(), true);
  }

  // The period drawn: the chosen one, or the one under the pointer (or the focus) while the end is chosen.
  const pending = previewFrom !== null ? (hovered ?? (keyed ? focused : null)) : null;
  const preview = previewFrom !== null && pending !== null && pending > previewFrom && isEnabled(pending) ? pending : null;
  const start = from;
  const candidate = preview ?? to;
  const end = start !== null && candidate !== null && candidate >= start ? candidate : null;

  return (
    <div className="flex flex-col gap-2" onPointerLeave={() => setHovered(null)}>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" className="size-10" disabled={!canPrevious} aria-label={t("previous")} onClick={() => go(shiftMonth(focused, -1), false)}>
          <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
        </Button>
        <h3 className="text-sm font-semibold capitalize" aria-live="polite" data-testid="range-calendar-month">
          {monthFormat.format(new Date(view * 86_400_000))}
        </h3>
        <Button type="button" variant="ghost" size="icon" className="size-10" disabled={!canNext} aria-label={t("next")} onClick={() => go(shiftMonth(focused, 1), false)}>
          <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
        </Button>
      </div>
      <table ref={grid} role="grid" aria-label={monthFormat.format(new Date(view * 86_400_000))} className="w-full table-fixed border-separate border-spacing-y-0.5" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th key={weekday.getTime()} scope="col" abbr={weekdayLong.format(weekday)} className="pb-1 text-center text-xs font-normal text-foreground-muted">
                {weekdayFormat.format(weekday)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(view).map((week, row) => (
            <tr key={row}>
              {week.map((day, col) => {
                if (day === null) return <td key={`pad-${col}`} />;
                const enabled = isEnabled(day);
                const isStart = start !== null && day === start;
                const isEnd = end !== null && day === end;
                const inside = start !== null && end !== null && day > start && day < end;
                const band = start !== null && end !== null && end > start && day >= start && day <= end;
                const date = new Date(day * 86_400_000);
                const label = `${fullFormat.format(date)}${isStart ? ` (${fromLabel})` : isEnd ? ` (${toLabel})` : ""}`;
                return (
                  <td key={day} aria-selected={isStart || isEnd || inside} className={cn("p-0", band && "bg-primary/12", band && isStart && "rounded-s-md", band && isEnd && "rounded-e-md")}>
                    <button
                      type="button"
                      tabIndex={day === focused ? 0 : -1}
                      data-day={dayString(day)}
                      aria-label={label}
                      aria-disabled={enabled ? undefined : true}
                      aria-current={day === today ? "date" : undefined}
                      className={cn(
                        "flex aspect-square w-full touch-manipulation items-center justify-center rounded-md text-sm tabular-nums outline-none transition-colors duration-150 select-none",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        enabled ? "cursor-pointer text-foreground hover:bg-surface-muted" : "cursor-default text-foreground-muted/45",
                        day === today && !isStart && !isEnd && "font-semibold ring-1 ring-structure ring-inset",
                        inside && "hover:bg-primary/20",
                        (isStart || isEnd) && "bg-primary font-semibold text-primary-foreground hover:bg-primary-hover",
                      )}
                      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(day)}
                      onFocus={() => setFocused(day)}
                      onClick={() => {
                        setFocused(day);
                        if (enabled) onPick(day);
                      }}
                    >
                      {dayFormat.format(date)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
