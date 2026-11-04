"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SWITCHABLE_LOCALES, type Locale } from "@/config/site";
import { useSamePageHref } from "./same-page-href";

// The other languages as links of the header menus (visitor and account) below md, where the
// language pill is not in the header: the footer has one, but the map home has no footer on a phone
// (UX journeys counter-review, 10). Same links as locale-menu.tsx: the page on screen, in that language.

function useOtherLocales() {
  const current = useLocale() as Locale;
  return { href: useSamePageHref(), others: SWITCHABLE_LOCALES.filter((locale) => locale !== current) };
}

const langOf = (locale: Locale) => (locale === "rif" ? "rif-Latn" : locale);

/** The other languages as a list, for the navigation dialogs of the header (visitor-menu.tsx, account-dropdown.tsx). */
export function LocaleLinks({ itemClassName, className }: { itemClassName: string; className?: string }) {
  const t = useTranslations("Locale");
  const { href, others } = useOtherLocales();
  if (others.length === 0) return null;
  return (
    <ul className={className}>
      {others.map((locale) => (
        <li key={locale}>
          <Link href={href} locale={locale} lang={langOf(locale)} className={itemClassName}>
            <Languages aria-hidden="true" />
            {t(`names.${locale}`)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
