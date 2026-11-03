"use client";

import { useId, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { inputClassName } from "@/components/ui/input";
import type { RentalUnit } from "@/config/categories";
import type { Locale } from "@/config/site";
import { RENTAL_SEARCH_AHEAD_DAYS, RENTAL_SEARCH_DAYS_MAX, dayNumber, dayString, moroccoToday } from "@/lib/listings/rental-availability";
import type { RentalDates } from "@/lib/search/params";
import { cn } from "@/lib/utils";
import { RangeCalendar } from "./range-calendar";
import { formatRentalDay, formatShortDay } from "./rental-day";

// Pick-up and return days of a car rental search (rental pack §4), Morocco's calendar: a pick-up
// from today to 180 days ahead and a return up to 60 days later (the same day counts as one day). A
// home (`unit` "night", seasonal rental conception §2): arrival and departure, one night at least.
// Both fields open one calendar (RangeCalendar): the first tap sets the start, the second the end,
// and a tap before the start starts over. The fields used to be native date inputs, which iPadOS
// Safari would not let the owner fill (report of 3 Nov 2026); the calendar works the same with a
// finger, a mouse or the keyboard, and dresses like the other fields. A GET form gets hidden inputs.

type Phase = "from" | "to";

/** About the calendar popover's height (6 weeks), with its margin. */
const CALENDAR_HEIGHT = 460;

export interface RentalDatesFieldsProps {
  value: Partial<RentalDates>;
  onChange: (value: Partial<RentalDates>) => void;
  className?: string;
  /** Field names of a GET form (the home module). */
  names?: { from: string; to: string };
  inputClassName?: string;
  /** "night": a stay's arrival and departure (the departure comes after the arrival). */
  unit?: RentalUnit;
}

export function RentalDatesFields({ value, onChange, className, names, inputClassName: fieldClassName, unit = "day" }: RentalDatesFieldsProps) {
  const t = useTranslations("Rental.search");
  const locale = useLocale() as Locale;
  const ids = useId();
  const fields = useRef<HTMLDivElement>(null);
  const buttons = { from: useRef<HTMLButtonElement>(null), to: useRef<HTMLButtonElement>(null) };
  const [today] = useState(() => moroccoToday(Date.now()));
  const [phase, setPhase] = useState<Phase | null>(null);
  /** The field focused again once the calendar closes. */
  const last = useRef<Phase>("from");
  const nights = unit === "night";
  const gap = nights ? 1 : 0;
  const parsed = (day: string | undefined) => (day ? dayNumber(day) : Number.NaN);
  const from = Number.isNaN(parsed(value.from)) ? null : parsed(value.from);
  const to = Number.isNaN(parsed(value.to)) ? null : parsed(value.to);
  const lastFrom = today + RENTAL_SEARCH_AHEAD_DAYS;
  const startable = (day: number) => day >= today && day <= lastFrom;
  const endable = (day: number) => from !== null && day >= from + gap && day - from <= RENTAL_SEARCH_DAYS_MAX && day >= today;
  const label = (field: Phase) => t(nights ? (`home.${field}` as const) : field);
  const text = (key: "pickFrom" | "pickTo" | "calendar") => t(nights ? (`home.${key}` as const) : key);
  // With no start yet, the return field opens on the start.
  const picking: Phase | null = phase === "to" && from === null ? "from" : phase;

  function open(field: Phase) {
    last.current = field;
    // Room for the calendar under the fields or above them, else the fields go up to the top of
    // what scrolls (a phone in landscape, the request dialog): the popover stays fully visible.
    const box = fields.current?.getBoundingClientRect();
    if (box && window.innerHeight - box.bottom < CALENDAR_HEIGHT && box.top < CALENDAR_HEIGHT) fields.current?.scrollIntoView({ block: "start" });
    setPhase(field);
  }

  function pick(day: number) {
    if (picking === "to" && endable(day)) {
      onChange({ ...value, to: dayString(day) });
      last.current = "to";
      setPhase(null);
      return;
    }
    if (!startable(day)) return;
    // A new start keeps the return when it still fits; the end is chosen next.
    const keep = to !== null && to >= day + gap && to - day <= RENTAL_SEARCH_DAYS_MAX;
    onChange({ from: dayString(day), to: keep ? value.to : undefined });
    last.current = "to";
    setPhase("to");
  }

  function field(name: Phase) {
    const day = name === "from" ? value.from : value.to;
    const valid = day !== undefined && !Number.isNaN(dayNumber(day));
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label id={`${ids}-${name}-label`} htmlFor={`${ids}-${name}`} className="text-xs text-foreground-muted">
          {label(name)}
        </label>
        <span className="relative flex">
          <CalendarDays className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-structure dark:text-gold-300" aria-hidden="true" />
          <button
            ref={buttons[name]}
            id={`${ids}-${name}`}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={picking === name}
            aria-controls={picking === name ? `${ids}-calendar` : undefined}
            aria-labelledby={`${ids}-${name}-label ${ids}-${name}-value`}
            data-value={day ?? ""}
            data-testid={`rental-dates-${name}`}
            className={cn(inputClassName, "flex touch-manipulation items-center ps-9 text-start", picking === name && "border-ring ring-3 ring-ring/25", fieldClassName)}
            onClick={() => (picking === name ? setPhase(null) : open(name))}
          >
            {/* The weekday when the field is wide enough (a narrow phone, Arabic's long weekdays). */}
            <span id={`${ids}-${name}-value`} className={cn("@container min-w-0 flex-1 truncate", !valid && "text-foreground-muted")}>
              {valid ? (
                <>
                  <span className="hidden @[8.5rem]:inline">{formatRentalDay(day, locale)}</span>
                  <span className="@[8.5rem]:hidden">{formatShortDay(day, locale)}</span>
                </>
              ) : (
                t("placeholder")
              )}
            </span>
          </button>
          {names ? <input type="hidden" name={names[name]} value={day ?? ""} /> : null}
        </span>
      </div>
    );
  }

  return (
    <Popover.Root open={picking !== null} onOpenChange={(next) => !next && setPhase(null)}>
      <Popover.Anchor asChild>
        <div ref={fields} className={cn("grid scroll-mt-36 grid-cols-2 gap-2", className)}>
          {field("from")}
          {field("to")}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={`${ids}-calendar`}
          role="dialog"
          aria-label={text("calendar")}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          data-testid="rental-dates-calendar"
          className="z-[60] flex max-h-(--radix-popover-content-available-height) w-[min(21rem,calc(100vw-2rem))] flex-col overflow-y-auto overscroll-contain gap-3 rounded-lg border border-border bg-surface p-3 text-foreground shadow-lg shadow-bab-950/15 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(event) => {
            // The day in the tab order, not the first button: once the popover's focus scope is up
            // (inside a dialog, the dialog's scope would take an earlier focus back).
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>("button[data-day][tabindex='0']")?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            buttons[last.current].current?.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            // The other field switches the calendar over instead of closing it.
            if (event.target instanceof Node && fields.current?.contains(event.target)) event.preventDefault();
          }}
        >
          <p className="px-1 text-sm font-medium" role="status" data-testid="rental-dates-hint">
            {text(picking === "to" ? "pickTo" : "pickFrom")}
          </p>
          {picking !== null ? (
            <RangeCalendar
              key={picking}
              locale={locale}
              today={today}
              from={from}
              to={to}
              previewFrom={picking === "to" ? from : null}
              isEnabled={picking === "to" ? (day) => endable(day) || (startable(day) && from !== null && day < from + gap) : startable}
              initialFocus={picking === "to" ? (to ?? (from ?? today) + 1) : (from ?? today)}
              firstDay={today}
              lastDay={lastFrom + RENTAL_SEARCH_DAYS_MAX}
              onPick={pick}
              fromLabel={label("from")}
              toLabel={label("to")}
              autoFocus
            />
          ) : null}
          {value.from || value.to ? (
            <button
              type="button"
              className="self-start rounded-md px-1 py-1 text-sm font-medium text-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => {
                onChange({ from: undefined, to: undefined });
                last.current = "from";
                setPhase("from");
              }}
            >
              {t("clear")}
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Both days set and in order (a stay: one night at least): the dates a search can carry. */
export function completeDates(value: Partial<RentalDates>, unit: RentalUnit = "day"): RentalDates | undefined {
  if (!value.from || !value.to) return undefined;
  const from = dayNumber(value.from);
  const to = dayNumber(value.to);
  const first = from + (unit === "night" ? 1 : 0);
  return !Number.isNaN(from) && !Number.isNaN(to) && to >= first && to - from <= RENTAL_SEARCH_DAYS_MAX ? { from: value.from, to: value.to } : undefined;
}
