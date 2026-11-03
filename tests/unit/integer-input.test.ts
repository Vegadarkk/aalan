import { describe, expect, it } from "vitest";
import { caretAfterCounted, countedBefore, formatInteger, readIntegerInput } from "@/lib/listings/client/integer-input";

describe("readIntegerInput", () => {
  it("reads digits, grouping spaces and Arabic-Indic digits", () => {
    expect(readIntegerInput("1 500 000")).toEqual({ ok: true, value: 1_500_000 });
    expect(readIntegerInput("1 500")).toEqual({ ok: true, value: 1500 });
    expect(readIntegerInput("١٢٣")).toEqual({ ok: true, value: 123 });
    expect(readIntegerInput("")).toEqual({ ok: true, value: null });
    expect(readIntegerInput("  ")).toEqual({ ok: true, value: null });
  });

  it("accepts dots that group thousands, refuses decimals instead of dropping the separator (zone 3 P2-5)", () => {
    expect(readIntegerInput("1.500.000")).toEqual({ ok: true, value: 1_500_000 });
    expect(readIntegerInput("12,5")).toEqual({ ok: false, issue: "decimal" });
    expect(readIntegerInput("12.5")).toEqual({ ok: false, issue: "decimal" });
    expect(readIntegerInput("2,5 %")).toEqual({ ok: false, issue: "decimal" });
  });

  it("refuses signs and letters unless negatives are allowed", () => {
    expect(readIntegerInput("-2")).toEqual({ ok: false, issue: "negative" });
    expect(readIntegerInput("2-")).toEqual({ ok: false, issue: "negative" });
    expect(readIntegerInput("abc")).toEqual({ ok: false, issue: "not_digits" });
    expect(readIntegerInput("12a")).toEqual({ ok: false, issue: "not_digits" });
    expect(readIntegerInput("-2", { allowNegative: true })).toEqual({ ok: true, value: -2 });
    expect(readIntegerInput("-", { allowNegative: true })).toEqual({ ok: true, value: null, partial: "-" });
  });

  it("refuses a value over the maximum instead of capping it", () => {
    expect(readIntegerInput("9999", { max: 9999 })).toEqual({ ok: true, value: 9999 });
    expect(readIntegerInput("99999", { max: 9999 })).toEqual({ ok: false, issue: "too_big" });
    expect(readIntegerInput("100", { max: 90 })).toEqual({ ok: false, issue: "too_big" });
    expect(readIntegerInput("99999999999999999999")).toEqual({ ok: false, issue: "too_big" });
  });
});

describe("caret helpers", () => {
  it("keeps the caret after the same digit when the thousands re-group (B9)", () => {
    // "350 000": the person types "1" after the 3 -> the browser shows "3150 000", caret at 2.
    const typed = "3150 000";
    const before = countedBefore(typed, 2);
    expect(before).toBe(2);
    const shown = formatInteger(3_150_000, true);
    expect(shown).toBe("3\u202f150\u202f000");
    // The caret lands after "31", not at the end.
    expect(caretAfterCounted(shown, before)).toBe(3);
    expect(shown.slice(0, caretAfterCounted(shown, before)).replace(/\D/g, "")).toBe("31");
  });

  it("puts the caret at the start or the end at the bounds", () => {
    expect(caretAfterCounted("1 500", 0)).toBe(0);
    expect(caretAfterCounted("1 500", 4)).toBe(5);
    expect(caretAfterCounted("1 500", 9)).toBe(5);
  });

  it("formats signed values", () => {
    expect(formatInteger(-2, false)).toBe("-2");
    expect(formatInteger(-1500, true)).toBe("-1\u202f500");
    expect(formatInteger(null, true)).toBe("");
    expect(formatInteger(0, true)).toBe("0");
  });
});
