"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { UseFormRegisterReturn } from "react-hook-form";
import { InlineError } from "@/components/feedback/inline-error";
import { Link } from "@/i18n/navigation";

// Sign-up consents (§7): the CGU, required, and the optional marketing opt-in, unchecked by default,
// then two notices without a box. The transfers outside Morocco rest on the performance of the
// contract (loi 09-08 art. 44 pt 4; GDPR: EU-US DPF or SCCs), not on consent (audit B2, zone 8 P0):
// a required box would not be a free consent, so sign-up only points to privacy policy §7.

type ConsentName = "cgu" | "marketing";

interface ConsentFieldsProps {
  fields: Record<ConsentName, UseFormRegisterReturn>;
  errors?: Partial<Record<"cgu", ReactNode>>;
  /** Focus the first checkbox on mount (the consents replaced the previous screen). */
  autoFocus?: boolean;
}

function legalLink(href: "/legal/cgu" | "/legal/confidentialite" | "/legal/confidentialite#transferts") {
  return function LegalLink(chunks: ReactNode) {
    return (
      <Link href={href} target="_blank" rel="noopener" className="font-medium text-link underline underline-offset-2">
        {chunks}
      </Link>
    );
  };
}

export function ConsentFields({ fields, errors = {}, autoFocus }: ConsentFieldsProps) {
  const t = useTranslations("Auth.consents");
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="sr-only">{t("legend")}</legend>
      <ConsentBox field={fields.cgu} error={errors.cgu} required autoFocus={autoFocus}>
        {t.rich("cgu", { link: legalLink("/legal/cgu") })}
      </ConsentBox>
      <ConsentBox field={fields.marketing}>{t("marketing")}</ConsentBox>
      <div className="flex flex-col gap-1.5 text-xs text-foreground-muted text-pretty">
        <p>{t.rich("privacy", { link: legalLink("/legal/confidentialite") })}</p>
        <p>{t.rich("transfersNotice", { link: legalLink("/legal/confidentialite#transferts") })}</p>
      </div>
    </fieldset>
  );
}

function ConsentBox({
  field,
  error,
  required,
  autoFocus,
  children,
}: {
  field: UseFormRegisterReturn;
  error?: ReactNode;
  required?: boolean;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-required={required || undefined}
          autoFocus={autoFocus}
          className="mt-1 size-5 shrink-0 cursor-pointer rounded-sm border-border-strong accent-primary"
          {...field}
        />
        <span className="text-pretty">{children}</span>
      </label>
      {error ? (
        <InlineError id={errorId} className="ps-8">
          {error}
        </InlineError>
      ) : null}
    </div>
  );
}
