"use client";

import { useCallback, useLayoutEffect, useReducer, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { groupDigits } from "@/lib/listings/client/format";
import { caretAfterCounted, countedBefore, countedIn, formatInteger, readIntegerInput, type IntegerIssue } from "@/lib/listings/client/integer-input";

// Controlled whole-number box (see integer-input.ts): a refused keystroke leaves the value as it
// was and says why (`notice`), and the caret stays on the digit it was next to while the thousands
// re-group. Callers render the notice where their field shows messages.

export interface IntegerFieldOptions {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  max?: number;
  allowNegative?: boolean;
  /** Thousands grouped as you type ("1 500 000"). */
  grouped?: boolean;
}

export interface IntegerField {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  notice: IntegerIssue | null;
}

/** `ref` is the box's own ref (the caller attaches it to the input): the caret is set through it. */
export function useIntegerField(ref: RefObject<HTMLInputElement | null>, { value, onChange, max, allowNegative = false, grouped = false }: IntegerFieldOptions): IntegerField {
  const [partial, setPartial] = useState<string | null>(null);
  const [notice, setNotice] = useState<IntegerIssue | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const caret = useRef<number | null>(null);
  const text = partial ?? formatInteger(value, grouped);

  // After each render that follows a keystroke: the caret goes back after the same digit.
  useLayoutEffect(() => {
    const target = caret.current;
    caret.current = null;
    const input = ref.current;
    if (target === null || !input || input.ownerDocument.activeElement !== input) return;
    const position = caretAfterCounted(input.value, target);
    input.setSelectionRange(position, position);
  });

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const at = event.target.selectionStart ?? raw.length;
      const before = countedBefore(raw, at);
      const read = readIntegerInput(raw, { max, allowNegative });
      if (!read.ok) {
        // The refused characters were just typed before the caret: step back over them.
        caret.current = Math.max(0, before - Math.max(0, countedIn(raw) - countedIn(text)));
        setNotice(read.issue);
        rerender();
        return;
      }
      setNotice(null);
      setPartial(read.partial ?? null);
      caret.current = before;
      if (read.value !== (value ?? null)) onChange(read.value);
      else rerender();
    },
    [allowNegative, max, onChange, text, value],
  );

  const handleBlur = useCallback(() => {
    setNotice(null);
    setPartial(null);
  }, []);

  return { value: text, onChange: handleChange, onBlur: handleBlur, notice };
}

/** The sentence of a refused keystroke. */
export function useIntegerNoticeMessage(): (issue: IntegerIssue | null, max?: number) => string | undefined {
  const t = useTranslations("Listing.numberInput");
  return useCallback(
    (issue, max) => {
      if (!issue) return undefined;
      if (issue === "too_big") return max === undefined ? t("tooBigPlain") : t("tooBig", { max: groupDigits(String(max)) });
      return t(issue === "not_digits" ? "notDigits" : issue);
    },
    [t],
  );
}
