import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Scale, Truck } from "lucide-react";
import { BeforeSending } from "@/components/carriers/before-sending";
import { CarrierSearchForm, CarrierSortSelect } from "@/components/carriers/carrier-search-form";
import { DepartureResults } from "@/components/carriers/departure-results";
import { RouteAlertButton, type RouteAlertButtonProps } from "@/components/carriers/route-alert-button";
import { PageMessages } from "@/components/i18n/page-messages";
import { Container } from "@/components/layout/container";
import { summarizeSearch } from "@/components/saved-searches/summary";
import { makeFilterLabels, type LooseTranslator } from "@/components/search/filter-labels";
import { describeFilters } from "@/components/search/filter-model";
import { SearchChallenge } from "@/components/search/search-challenge";
import { SearchError } from "@/components/search/search-error";
import { Button } from "@/components/ui/button";
import { DEPARTURE_SUBCATEGORY } from "@/config/categories";
import { LOCALE_TAGS, type Locale } from "@/config/site";
import { CARRIERS_PAGE_CLIENT_NAMESPACES } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { numbersLocale, pageLocale } from "@/i18n/params";
import { routeAlertParams } from "@/lib/carriers/route-alert";
import { searchDepartures, searchPeriod } from "@/lib/carriers/search";
import { basketOf, CARRIERS_PATH, carrierSearchQuery, parseCarrierSearch, type CarrierSearchParams } from "@/lib/carriers/search-params";
import { getFlags } from "@/lib/config/runtime";
import { SAVED_SEARCH_NAME_MAX } from "@/lib/contracts/search";
import type { CarrierSearchResponse } from "@/lib/contracts/carrier-search";
import { HttpError } from "@/lib/http/errors";
import { logger } from "@/lib/logging/logger";
import { enforceSearchLimit } from "@/lib/search/limits";
import { SearchUnavailableError } from "@/lib/search/types";
import { pageRequest } from "../recherche/search-state";

// Europe–Morocco carriers (transporteurs/spec.md §5): the next departures of a route with their
// room left and, from the client's basket, the price estimated from each carrier's list; sorted by
// date, price or rating, compared three at a time. Dynamic: the query string is the whole state,
// under the same limits as the search. Behind `carriersEnabled`. The bare page is indexed, a
// search is not.

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "CarrierSearch" });
  const searched = carrierSearchQuery(parseCarrierSearch(await searchParams)) !== "";
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: `/${locale}${CARRIERS_PATH}` },
    ...(searched ? { robots: { index: false, follow: true } } : {}),
  };
}

type Outcome = { kind: "results"; response: CarrierSearchResponse } | { kind: "challenge" } | { kind: "rate_limited"; retryAfter?: number } | { kind: "unavailable" };

async function load(query: CarrierSearchParams): Promise<Outcome> {
  try {
    await enforceSearchLimit(await pageRequest());
  } catch (error) {
    if (error instanceof HttpError && (error.code === "turnstile_required" || error.code === "turnstile_failed")) return { kind: "challenge" };
    if (error instanceof HttpError && error.code === "rate_limited") {
      const seconds = Number(error.headers?.["Retry-After"]);
      return { kind: "rate_limited", retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined };
    }
    logger.error({ err: (error as Error).message }, "carriers page: limit check failed");
    return { kind: "unavailable" };
  }
  try {
    return { kind: "results", response: await searchDepartures(query) };
  } catch (error) {
    if (error instanceof SearchUnavailableError) logger.warn({ err: error.message }, "carriers page: engine unavailable");
    else logger.error({ err: (error as Error).message }, "carriers page: search failed");
    return { kind: "unavailable" };
  }
}

/** The route alert of this search: its saved-search parameters, words and proposed name (server translators). */
async function routeAlert(locale: Locale, query: CarrierSearchParams): Promise<Omit<RouteAlertButtonProps, "label" | "variant" | "className">> {
  const params = routeAlertParams(query);
  const [t, carriers, chips, categories, criteria, units] = await Promise.all([
    getTranslations({ locale, namespace: "CarrierSearch.alert" }),
    getTranslations({ locale, namespace: "Carriers" }),
    getTranslations({ locale, namespace: "SearchFilters.chips" }),
    getTranslations({ locale, namespace: "Categories" }),
    getTranslations({ locale, namespace: "Criteria" }),
    getTranslations({ locale, namespace: "Listing.units" }),
  ]);
  const loose = (translator: unknown) => translator as LooseTranslator;
  const labels = makeFilterLabels({ chips: loose(chips), categories: loose(categories), criteria: loose(criteria), units: loose(units) }, locale);
  const route = describeFilters(params, locale, labels).find((filter) => filter.key === "route")?.label;
  const name = route ? t("name", { route }) : t("nameAll", { direction: carriers(`directions.${query.direction}`) });
  return { params, summary: summarizeSearch(params, locale, labels, (q) => q), suggestedName: name.slice(0, SAVED_SEARCH_NAME_MAX).trim() };
}

export default async function CarriersPage({ params, searchParams }: Props) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  if (!(await getFlags()).carriersEnabled) notFound();
  const query = parseCarrierSearch(await searchParams);
  const [t, outcome, alert] = await Promise.all([getTranslations({ locale, namespace: "CarrierSearch" }), load(query), routeAlert(locale, query)]);
  const period = searchPeriod(query, new Date());
  const basket = basketOf(query) !== null;
  const money = (minor: number, currency: string) => new Intl.NumberFormat(LOCALE_TAGS[numbersLocale(locale)], { style: "currency", currency }).format(minor / 100);
  const bare = !query.country && !query.zone && !query.city && !query.from && !query.to;

  return (
    <PageMessages locale={locale} namespaces={CARRIERS_PAGE_CLIENT_NAMESPACES}>
      <section className="border-b border-border bg-surface-brand/70">
        <Container className="flex flex-col gap-3 pt-10 pb-10 sm:pt-12">
          <h1 className="max-w-3xl text-3xl font-semibold text-balance sm:text-4xl">{t("title")}</h1>
          <p className="max-w-2xl text-lg text-pretty text-foreground-muted">{t("lead")}</p>
        </Container>
      </section>

      <Container className="grid gap-8 py-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-10 lg:py-10">
        <aside className="rounded-lg border border-border bg-surface p-4 sm:p-5 lg:sticky lg:top-24">
          <CarrierSearchForm params={query} period={period} searched={!bare || basket} />
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          {outcome.kind === "challenge" ? (
            <SearchChallenge params={{ category: "services", subcategory: DEPARTURE_SUBCATEGORY }} />
          ) : outcome.kind !== "results" ? (
            <SearchError kind={outcome.kind} retryAfter={outcome.kind === "rate_limited" ? outcome.retryAfter : undefined} />
          ) : outcome.response.departures.length === 0 ? (
            <section data-testid="carrier-empty" className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border-control bg-surface p-6 sm:p-8">
              <span className="flex size-12 items-center justify-center rounded-full bg-surface-brand text-structure dark:text-gold-300">
                <Truck aria-hidden="true" className="size-6" strokeWidth={1.75} />
              </span>
              <h2 className="text-xl font-semibold text-balance">{bare ? t("empty.soonTitle") : t("empty.title")}</h2>
              <p className="max-w-prose text-foreground-muted text-pretty">{bare ? t("empty.soonBody") : t("empty.body")}</p>
              <p className="max-w-prose text-sm text-pretty">{t("alert.hint")}</p>
              <div className="flex flex-wrap gap-3">
                <RouteAlertButton {...alert} label={t("alert.button")} variant="primary" />
                {bare ? null : (
                  <Button asChild variant="outline">
                    <Link href={CARRIERS_PATH}>{t("empty.reset")}</Link>
                  </Button>
                )}
                <Button asChild variant="ghost">
                  <Link href="/professionnels">{t("empty.carrier")}</Link>
                </Button>
              </div>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold" data-testid="carrier-count">
                  {t("count", { count: outcome.response.departures.length })}
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  <CarrierSortSelect params={query} basket={basket} />
                  <RouteAlertButton {...alert} label={t("alert.button")} />
                </div>
              </div>
              {outcome.response.guide ? (
                <p className="flex items-start gap-3 rounded-md bg-surface-muted px-4 py-3 text-sm text-pretty" data-testid="carrier-guide">
                  <Scale aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-structure dark:text-gold-300" />
                  <span>
                    {t("guide", { min: money(outcome.response.guide.min, outcome.response.guide.currency), max: money(outcome.response.guide.max, outcome.response.guide.currency), count: outcome.response.guide.carriers })}
                  </span>
                </p>
              ) : null}
              <DepartureResults cards={outcome.response.departures} basket={basket} />
            </>
          )}
          <BeforeSending />
          <p className="max-w-prose text-xs text-foreground-muted text-pretty">{t("notice")}</p>
        </div>
      </Container>
    </PageMessages>
  );
}
