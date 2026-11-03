"use client";

import { useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { PriceUnit, Subcategory } from "@/config/categories";
import { isRtl, type Locale } from "@/config/site";
import { currencyLabel } from "@/lib/listings/client/format";
import { PRICE_MAX } from "@/lib/listings/client/validation";
import { cn } from "@/lib/utils";
import { useIntegerField, useIntegerNoticeMessage } from "./controls/integer-field";
import { SwitchField } from "./controls/switch";

// Step 6 (design D4): integer dirhams with thousands grouping as you type (the caret stays on its
// digit, a comma or a sign is refused with a message: B9, zone 3 P2-5), "Négociable",
// "Je donne" when the subcategory allows donations, "À discuter" when the price is optional, and
// the unit ("par nuit", "par mois") when the subcategory sets one. A job offer's amount is a
// monthly gross salary (`priceMode: "salary"`): same box, its own words.

export interface PriceInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  negotiable: boolean;
  onNegotiable: (value: boolean) => void;
  isDonation: boolean;
  onDonation: (value: boolean) => void;
  donationAllowed: boolean;
  priceOptional: boolean;
  priceUnit?: PriceUnit;
  /** "salary": the amount is a monthly gross salary (a job offer); the labels say so. */
  priceMode?: Subcategory["priceMode"];
  error?: string;
  /** Non-blocking note under the box: the price is far above its subcategory's usual range. */
  warning?: string;
  onBlur?: () => void;
  /** Overrides the hook (unit tests render without a provider for the locale). */
  locale?: Locale;
}

export function PriceInput({ value, onChange, negotiable, onNegotiable, isDonation, onDonation, donationAllowed, priceOptional, priceUnit, priceMode, error, warning, onBlur, locale: localeProp }: PriceInputProps) {
  const t = useTranslations("Listing.fields");
  const salary = priceMode === "salary";
  const hookLocale = useLocale() as Locale;
  const locale = localeProp ?? hookLocale;
  // "À discuter": the person asked for no amount (distinct from "not typed yet").
  const [toDiscuss, setToDiscuss] = useState(priceOptional && value === null && !isDonation);
  // Digits only, grouped as you type: the text is a pure function of the integer value.
  const input = useRef<HTMLInputElement>(null);
  const amount = useIntegerField(input, { value, onChange, max: PRICE_MAX, grouped: true });
  const notice = useIntegerNoticeMessage()(amount.notice, PRICE_MAX);

  const disabled = isDonation || toDiscuss;
  // The digits stay left to right (dir="ltr" on the input), so the box uses physical sides: the
  // currency sits at the reading end (right in French, left in Arabic) and the reserved padding is
  // on that same side, the amount aligned at the other end.
  const rtl = isRtl(locale);

  return (
    <div className="flex flex-col gap-5" onBlur={onBlur}>
      <Field label={t(salary ? "salary" : "price")} hint={disabled ? undefined : t(salary ? "salaryHint" : "priceHint")} error={notice ?? error} required={!priceOptional && !isDonation}>
        <AmountBox
          inputRef={input}
          suffix={
            <span className={cn("pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col leading-tight", rtl ? "left-4 items-start" : "right-4 items-end")} aria-hidden="true">
              <span className="text-lg font-medium text-foreground-muted">{currencyLabel(locale)}</span>
              {priceUnit ? <span className="text-xs text-foreground-muted">{t(`per.${priceUnit}`)}</span> : null}
            </span>
          }
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={disabled ? "" : t(salary ? "salaryPlaceholder" : "pricePlaceholder")}
          value={isDonation ? "0" : toDiscuss ? "" : amount.value}
          disabled={disabled}
          dir="ltr"
          className={cn("h-14 text-2xl font-semibold tabular-nums", rtl ? "pl-20 text-right" : "pr-20 text-left", disabled && "text-foreground-muted")}
          onChange={amount.onChange}
          onBlur={amount.onBlur}
        />
      </Field>
      {warning && !disabled && !error && !notice ? (
        <p role="status" data-testid="price-warning" className="-mt-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span className="text-pretty">{warning}</span>
        </p>
      ) : null}

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border px-4">
        {priceOptional ? (
          <SwitchField
            label={t(salary ? "salaryToDiscuss" : "toDiscuss")}
            hint={t(salary ? "salaryToDiscussHint" : "toDiscussHint")}
            checked={toDiscuss}
            disabled={isDonation}
            onCheckedChange={(checked) => {
              setToDiscuss(checked);
              if (checked) onChange(null);
              // Back to an amount: the field is where the next keystroke goes.
              else requestAnimationFrame(() => input.current?.focus());
            }}
            className="py-3"
          />
        ) : null}
        <SwitchField label={t("negotiable")} hint={t("negotiableHint")} checked={negotiable && !isDonation} disabled={isDonation} onCheckedChange={onNegotiable} className="py-3" />
        {donationAllowed ? (
          <SwitchField
            label={t("donation")}
            hint={t("donationHint")}
            checked={isDonation}
            onCheckedChange={(checked) => {
              onDonation(checked);
              if (checked) {
                setToDiscuss(false);
                onChange(null);
                onNegotiable(false);
              } else requestAnimationFrame(() => input.current?.focus());
            }}
            className="py-3"
          />
        ) : null}
      </div>
    </div>
  );
}

interface AmountBoxProps extends InputHTMLAttributes<HTMLInputElement> {
  inputRef: Ref<HTMLInputElement>;
  suffix: ReactNode;
}

/** Field clones its child with id and aria-*: the box hands them to the input, not to the wrapper. */
function AmountBox({ inputRef, suffix, ...props }: AmountBoxProps) {
  return (
    <div className="relative">
      <Input ref={inputRef} {...props} />
      {suffix}
    </div>
  );
}
