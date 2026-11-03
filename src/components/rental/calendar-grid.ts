import { dayNumber, dayString } from "@/lib/listings/rental-availability";

// Month arithmetic of the rental calendars (day numbers: days since 1970-01-01, Morocco's calendar).

/** Day number of the first day of the month `offset` months after the month of `day`. */
export function monthStart(day: number, offset = 0): number {
  const [year, month] = dayString(day).split("-").map(Number) as [number, number];
  return dayNumber(new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10));
}

/** 0 = Monday ... 6 = Sunday (1970-01-01 was a Thursday). */
export const weekdayIndex = (day: number) => (((day + 3) % 7) + 7) % 7;

/** Months from the month of `from` to the month of `to` (negative when `to` is earlier). */
export function monthsBetween(from: number, to: number): number {
  const [fromYear, fromMonth] = dayString(from).split("-").map(Number) as [number, number];
  const [toYear, toMonth] = dayString(to).split("-").map(Number) as [number, number];
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** The weeks of the month starting on `first`, Monday first, padded with null. */
export function monthWeeks(first: number): (number | null)[][] {
  const next = monthStart(first, 1);
  const cells: (number | null)[] = [...Array.from({ length: weekdayIndex(first) }, () => null), ...Array.from({ length: next - first }, (_, offset) => first + offset)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
