import { groupDigits } from "./format";

// Whole-number boxes of the listing forms (price, stock, promo, criteria): what was typed is either
// taken as is or refused with a reason, never rewritten in silence (zone 3 audit P2-5: "12,5" used
// to become 125, "-2" became 2, "99999" became 9999). The caret helpers keep the cursor on the
// same digit when the box re-groups the thousands (B9: "350 000" turned into "31 500 002").

export type IntegerIssue = "decimal" | "negative" | "not_digits" | "too_big";

export type IntegerRead = { ok: true; value: number | null; partial?: "-" } | { ok: false; issue: IntegerIssue };

/** Separators a person may type or paste between thousands: spaces of every width. */
const SPACES = /[\s   ]/g;

export function toWesternDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export interface IntegerBounds {
  max?: number;
  /** Negatives accepted (a floor below ground level). */
  allowNegative?: boolean;
}

/** Reads a whole-number box: the integer, null when empty, or why the text is refused. */
export function readIntegerInput(text: string, { max, allowNegative = false }: IntegerBounds = {}): IntegerRead {
  const compact = toWesternDigits(text).replace(SPACES, "").replace(/−/g, "-");
  if (compact === "") return { ok: true, value: null };
  if (allowNegative && compact === "-") return { ok: true, value: null, partial: "-" };
  // "1.500.000" pasted from elsewhere: dots that group thousands, not decimals.
  const body = /^-?\d{1,3}(\.\d{3})+$/.test(compact) ? compact.replace(/\./g, "") : compact;
  const match = /^(-?)(\d+)$/.exec(body);
  if (!match) {
    if (/[.,٫،]/.test(body)) return { ok: false, issue: "decimal" };
    if (body.includes("-") && !allowNegative && /^[\d-]+$/.test(body)) return { ok: false, issue: "negative" };
    return { ok: false, issue: "not_digits" };
  }
  if (match[1] && !allowNegative) return { ok: false, issue: "negative" };
  const value = Number(body);
  if (!Number.isSafeInteger(value) || (max !== undefined && value > max)) return { ok: false, issue: "too_big" };
  // "-0" is 0.
  return { ok: true, value: value === 0 ? 0 : value };
}

/** The box's text for a value: grouped thousands ("1 500 000") or plain digits. */
export function formatInteger(value: number | null | undefined, grouped: boolean): string {
  if (value === null || value === undefined) return "";
  if (!grouped) return String(value);
  const digits = groupDigits(String(Math.abs(value))) || "0";
  return value < 0 ? `-${digits}` : digits;
}

/** Characters that carry the number (digits and the sign); separators are not counted. */
const COUNTED = /[0-9٠-٩۰-۹\-−]/;

export function countedBefore(text: string, caret: number): number {
  let count = 0;
  for (let index = 0; index < Math.min(caret, text.length); index += 1) if (COUNTED.test(text[index]!)) count += 1;
  return count;
}

export function countedIn(text: string): number {
  return countedBefore(text, text.length);
}

/** Caret position right after the `count`-th counted character of `text`. */
export function caretAfterCounted(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (COUNTED.test(text[index]!)) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return text.length;
}
