"use client";

import { useRef, type InputHTMLAttributes } from "react";
import { InlineError } from "@/components/feedback/inline-error";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIntegerField, useIntegerNoticeMessage } from "./integer-field";

// A small whole-number box (stock, a combination's price, a promotion's percent) with the reason of
// a refused keystroke right under it. Fields that already show messages (Field) use the hook.

type BoxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "max">;

export interface IntegerBoxProps extends BoxProps {
  value: number | null | undefined;
  onValue: (value: number | null) => void;
  max?: number;
  grouped?: boolean;
  /** Classes of the wrapper (the box keeps `className`). */
  wrapperClassName?: string;
}

export function IntegerBox({ value, onValue, max, grouped = false, className, wrapperClassName, onBlur, ...props }: IntegerBoxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const field = useIntegerField(ref, { value, onChange: onValue, max, grouped });
  const notice = useIntegerNoticeMessage()(field.notice, max);
  return (
    <span className={cn("flex flex-col gap-1", wrapperClassName)}>
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        dir="ltr"
        autoComplete="off"
        className={cn("tabular-nums", className)}
        aria-invalid={notice ? true : props["aria-invalid"]}
        value={field.value}
        onChange={field.onChange}
        onBlur={(event) => {
          field.onBlur();
          onBlur?.(event);
        }}
      />
      {notice ? <InlineError className="text-xs">{notice}</InlineError> : null}
    </span>
  );
}
