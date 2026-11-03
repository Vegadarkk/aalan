import { describe, expect, it } from "vitest";
import { monthStart, monthWeeks, monthsBetween, weekdayIndex } from "@/components/rental/calendar-grid";
import { dayNumber, dayString } from "@/lib/listings/rental-availability";

describe("calendar grid", () => {
  it("finds a month's first day across years", () => {
    expect(dayString(monthStart(dayNumber("2026-11-17")))).toBe("2026-11-01");
    expect(dayString(monthStart(dayNumber("2026-11-17"), 2))).toBe("2027-01-01");
    expect(dayString(monthStart(dayNumber("2026-01-31"), -1))).toBe("2025-12-01");
  });

  it("counts months between two days", () => {
    expect(monthsBetween(dayNumber("2026-11-30"), dayNumber("2027-02-01"))).toBe(3);
    expect(monthsBetween(dayNumber("2026-11-30"), dayNumber("2026-11-01"))).toBe(0);
    expect(monthsBetween(dayNumber("2027-01-05"), dayNumber("2026-12-31"))).toBe(-1);
  });

  it("lays a month out in weeks, Monday first", () => {
    // November 2026 starts on a Sunday: six leading blanks, then 30 days over six weeks.
    const weeks = monthWeeks(dayNumber("2026-11-01"));
    expect(weekdayIndex(dayNumber("2026-11-01"))).toBe(6);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]!.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(dayString(weeks[0]![6]!)).toBe("2026-11-01");
    expect(weeks.flat().filter((day) => day !== null)).toHaveLength(30);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });
});
