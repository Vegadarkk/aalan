import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMorocco, moroccoLocalToIso } from "@/app/admin/_lib/moderation-format";

// B11 / audit zone 7 P1-3: one display zone (Morocco) in every back-office page and form.

describe("back-office dates", () => {
  it("shows Morocco's wall clock: UTC+0 since 20 Sept 2026, UTC+1 before", () => {
    expect(formatDateTime("2026-11-03T18:30:00.000Z")).toBe("3 nov. 2026, 18:30");
    expect(formatDateTime("2026-06-01T09:00:00.000Z")).toBe("1 juin 2026, 10:00");
    expect(formatDate("2026-11-03T23:59:00.000Z")).toBe("3 nov. 2026");
    expect(formatMorocco(Date.UTC(2026, 10, 3, 18, 30), "longDate")).toBe("3 novembre 2026");
  });

  it("returns an empty string for a missing or invalid date", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("")).toBe("");
    expect(formatMorocco("not a date")).toBe("");
  });

  it("reads a datetime-local value as Morocco's time, whatever the browser's zone", () => {
    expect(moroccoLocalToIso("2026-11-03T18:30")).toBe("2026-11-03T18:30:00.000Z");
    expect(moroccoLocalToIso("2026-06-01T10:00")).toBe("2026-06-01T09:00:00.000Z");
    expect(moroccoLocalToIso("2026-11-03T18:30:15")).toBe("2026-11-03T18:30:00.000Z");
    expect(formatDateTime(moroccoLocalToIso("2026-11-03T18:30"))).toBe("3 nov. 2026, 18:30");
  });

  it("rejects an empty or malformed value", () => {
    expect(moroccoLocalToIso("")).toBeUndefined();
    expect(moroccoLocalToIso("03/11/2026 18:30")).toBeUndefined();
  });
});
