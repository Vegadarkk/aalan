import { getTranslations } from "next-intl/server";
import { makeFilterLabels, type LooseTranslator } from "@/components/search/filter-labels";
import { localeParams, pageLocale } from "@/i18n/params";
import type { Locale } from "@/config/site";
import type { SuggestionLabels } from "@/lib/search/suggest-match";
import { buildSuggestions } from "@/lib/search/suggestions";

// The search suggestions index of a locale (audit §7, src/lib/search/suggestions.ts): config,
// lexicon and message catalogs only, built at build time, the same for every visitor. The browser
// keeps it an hour and Cloudflare a day, like the footer directory.
export const dynamicParams = false;

export function generateStaticParams() {
  return localeParams();
}

async function labelsOf(locale: Locale): Promise<SuggestionLabels> {
  const [chips, categories, criteria, units] = await Promise.all([
    getTranslations({ locale, namespace: "SearchFilters.chips" }),
    getTranslations({ locale, namespace: "Categories" }),
    getTranslations({ locale, namespace: "Criteria" }),
    getTranslations({ locale, namespace: "Listing.units" }),
  ]);
  const loose = (t: unknown) => t as LooseTranslator;
  return makeFilterLabels({ chips: loose(chips), categories: loose(categories), criteria: loose(criteria), units: loose(units) }, locale);
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }): Promise<Response> {
  const locale = pageLocale((await params).locale);
  const labels = await labelsOf(locale);
  const index = buildSuggestions(labels, locale === "fr" ? undefined : await labelsOf("fr"));
  return Response.json(index, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } });
}
