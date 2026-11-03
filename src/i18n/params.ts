import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import type { Locale } from "@/config/site";
import { routing } from "./routing";

/** The [locale] param as a Locale; an unknown value is a 404 (layouts already reject it). */
export function pageLocale(value: string): Locale {
  if (!hasLocale(routing.locales, value)) notFound();
  return value;
}

/**
 * Build-time params of a public page: every locale, times the page's own params when it has a
 * dynamic segment. Each page built ahead returns it from its own generateStaticParams; the
 * (public) layout gives none, because a parent's params are always prerendered and a child's
 * empty list cannot remove them (Next.js passes the parent's params through). So the home,
 * rendered on its first visit only, returns [] and stays out of the build.
 */
export function localeParams<T extends Record<string, string> = Record<never, never>>(params: readonly T[] = [{} as T]): ({ locale: Locale } & T)[] {
  return routing.locales.flatMap((locale) => params.map((param) => ({ locale, ...param })));
}

/**
 * Locale of the Intl formatting of numbers, plurals (ICU `#`) and dates. Tarifit has no Intl data:
 * under "rif" the runtime default would format them (en-US: "1,200", "October 13, 2026", English
 * plural rules), so Tarifit pages format them as French ("1 200"). Translators that print numbers
 * take the Tarifit text with this formatting: getNumbersTranslations (server) and
 * useNumbersTranslations (client). The request locale stays "rif" (routing, links, messages).
 */
export function numbersLocale(locale: Locale): Locale {
  return locale === "rif" ? "fr" : locale;
}
