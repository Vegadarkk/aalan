import { describe, expect, it } from "vitest";
import { moroccoClock, openState, weekRows } from "@/lib/pro/hours";
import { openingHoursSchema, type OpeningHours } from "@/lib/pro/profile-schema";

// A shop's weekly hours on Morocco's clock (UX audit of the Pro shops, lot 1): open state, next
// opening, week rows, and the schema's refusals.

const HOURS: OpeningHours = {
  days: [
    { day: "mon", slots: [{ from: "09:00", to: "12:30" }, { from: "14:30", to: "19:00" }] },
    { day: "sat", slots: [{ from: "10:00", to: "18:00" }] },
  ],
  note: "",
};
// Monday 2 November 2026; Morocco is on UTC since 20 September 2026.
const at = (day: number, time: string) => Date.parse(`2026-11-${String(day).padStart(2, "0")}T${time}:00Z`);

describe("shop hours", () => {
  it("reads Morocco's weekday and minute", () => {
    expect(moroccoClock(at(2, "09:30"))).toEqual({ day: "mon", minute: 570 });
    expect(moroccoClock(at(8, "23:59"))).toEqual({ day: "sun", minute: 1439 });
  });

  it("says open until the end of the current period", () => {
    expect(openState(HOURS, at(2, "09:00"))).toEqual({ open: true, until: "12:30" });
    expect(openState(HOURS, at(2, "18:59"))).toEqual({ open: true, until: "19:00" });
  });

  it("says when it opens next: later today, or another day", () => {
    expect(openState(HOURS, at(2, "13:00"))).toEqual({ open: false, next: { day: "mon", from: "14:30", today: true } });
    expect(openState(HOURS, at(2, "19:00"))).toEqual({ open: false, next: { day: "sat", from: "10:00", today: false } });
    expect(openState(HOURS, at(8, "12:00"))).toEqual({ open: false, next: { day: "mon", from: "09:00", today: false } });
  });

  it("has no state without opening days", () => {
    expect(openState({ days: [], note: "Sur rendez-vous" }, at(2, "10:00"))).toBeNull();
  });

  it("lists the whole week, closed days empty", () => {
    const rows = weekRows(HOURS);
    expect(rows.map((row) => row.day)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    expect(rows[1]?.slots).toEqual([]);
  });

  it("refuses reversed, overlapping, duplicate and malformed periods", () => {
    expect(openingHoursSchema.safeParse(HOURS).success).toBe(true);
    const day = (slots: { from: string; to: string }[]) => ({ days: [{ day: "mon", slots }], note: "" });
    expect(openingHoursSchema.safeParse(day([{ from: "19:00", to: "09:00" }])).success).toBe(false);
    expect(openingHoursSchema.safeParse(day([{ from: "09:00", to: "13:00" }, { from: "12:00", to: "18:00" }])).success).toBe(false);
    expect(openingHoursSchema.safeParse(day([{ from: "9:00", to: "18:00" }])).success).toBe(false);
    expect(openingHoursSchema.safeParse({ days: [...HOURS.days, HOURS.days[0]], note: "" }).success).toBe(false);
  });
});
