import { moroccoTimeZone } from "@/lib/i18n/morocco-time";
import { WEEKDAYS, type OpeningHours, type Weekday } from "./profile-schema";

// A shop's weekly hours (UX audit of the Pro shops, lot 1) read on Morocco's wall clock: the day
// and minute now, and whether the shop is open, until when, or when it opens next. Pure.

const INTL_DAYS: Record<string, Weekday> = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

/** Morocco's weekday and minute of the day at `at` (epoch ms). */
export function moroccoClock(at: number): { day: Weekday; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: moroccoTimeZone(at) }).formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return { day: INTL_DAYS[part("weekday")] ?? "mon", minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

export type OpenState = { open: true; until: string } | { open: false; next: { day: Weekday; from: string; today: boolean } | null };

/** Open now and until when, or closed and the next opening within the week (null: no hours at all). */
export function openState(hours: OpeningHours, at: number): OpenState | null {
  if (hours.days.length === 0) return null;
  const { day, minute } = moroccoClock(at);
  const byDay = new Map(hours.days.map((entry) => [entry.day, entry.slots]));
  const today = byDay.get(day) ?? [];
  const current = today.find((slot) => minutes(slot.from) <= minute && minute < minutes(slot.to));
  if (current) return { open: true, until: current.to };
  const later = today.find((slot) => minutes(slot.from) > minute);
  if (later) return { open: false, next: { day, from: later.from, today: true } };
  const start = WEEKDAYS.indexOf(day);
  for (let step = 1; step <= 7; step += 1) {
    const next = WEEKDAYS[(start + step) % 7] ?? "mon";
    const slots = byDay.get(next);
    if (slots?.[0]) return { open: false, next: { day: next, from: slots[0].from, today: false } };
  }
  return { open: false, next: null };
}

/** The days in week order, closed days included (empty slots). */
export function weekRows(hours: OpeningHours): { day: Weekday; slots: OpeningHours["days"][number]["slots"] }[] {
  const byDay = new Map(hours.days.map((entry) => [entry.day, entry.slots]));
  return WEEKDAYS.map((day) => ({ day, slots: byDay.get(day) ?? [] }));
}
