import { CATEGORIES, CONDITIONS, categoryById, criterionById, datedRental, searchCriteria, subcategoryById, type Condition, type CriterionUnit } from "@/config/categories";
import { cityBySlug, cityName, regionByCode, regionName } from "@/config/regions";
import { euZoneById } from "@/config/carriers";
import type { Locale } from "@/config/site";
import { formatPrice, groupDigits, intlLocale } from "@/lib/listings/client/format";
import { canonicalSearchParams, rentalDuration, SEARCH_MAX_PAGE, SEARCH_PATH, searchQueryObject, type CriterionFilter, type SearchParams, type SearchSort } from "@/lib/search/params";
import type { SearchCard, SearchFacets } from "@/lib/search/types";
import { dayNumber, dayString } from "@/lib/listings/rental-availability";
import { locationName } from "./location";

// Pure model of the search filters on the UI side (design D6, D7, D22): which filters are active,
// how each one reads as a removable chip, the parameters without it, the sort choices, the page
// numbers and the refinements. Client-safe: chips, sheet, empty state and page share it.

/** next-intl `Link` / `router.push` target of a search (locale added by next-intl). */
export function searchLinkHref(params: SearchParams): { pathname: typeof SEARCH_PATH; query: Record<string, string> } {
  return { pathname: SEARCH_PATH, query: searchQueryObject(params) };
}

export type FilterKey =
  | "category"
  | "location"
  | "district"
  | "price"
  | "sellerType"
  | "seller"
  | "shop"
  | "donation"
  | "withPhoto"
  | "includeSoldOut"
  | "promo"
  | "conditions"
  | "dates"
  | "route"
  | `criterion:${string}`;

/** Messages of `SearchFilters.chips`. */
export const CHIP_KEYS = [
  "priceRange",
  "priceFrom",
  "priceTo",
  "radius",
  "zone",
  "zoneNear",
  "district",
  "sellerIndividual",
  "sellerPro",
  "seller",
  "shop",
  "donation",
  "withPhoto",
  "includeSoldOut",
  "promo",
  "conditions",
  "range",
  "rangeFrom",
  "rangeTo",
  "options",
  "dates",
  "datesNights",
  "route",
] as const;
export type ChipKey = (typeof CHIP_KEYS)[number];

/** Translations the chips need (built from next-intl by `useFilterLabels`, or by tests). */
export interface FilterLabels {
  category(categoryId: string): string;
  subcategory(categoryId: string, subcategoryId: string): string;
  criterion(criterionId: string): string;
  option(criterionId: string, optionId: string): string;
  condition(condition: Condition): string;
  unit(unit: CriterionUnit): string;
  chip(key: ChipKey, values?: Record<string, string | number>): string;
  /** List separator: ", " (fr) or "، " (ar). */
  separator: string;
}

export interface ActiveFilter {
  key: FilterKey;
  label: string;
  /** The same search without this filter (back to page 1). */
  without: SearchParams;
}

/** The parameters without one filter; page reset, contradictions removed. */
export function withoutFilter(params: SearchParams, key: FilterKey): SearchParams {
  const next: SearchParams = { ...params };
  delete next.page;
  if (key.startsWith("criterion:")) {
    const id = key.slice("criterion:".length);
    const criteria = { ...next.criteria };
    delete criteria[id];
    if (Object.keys(criteria).length) next.criteria = criteria;
    else delete next.criteria;
    return canonicalSearchParams(next);
  }
  switch (key) {
    case "category":
      // A subcategory chip goes back to its category; a category chip to every category.
      if (next.subcategory) delete next.subcategory;
      else delete next.category;
      delete next.criteria;
      break;
    case "location":
      delete next.city;
      delete next.region;
      delete next.zone;
      delete next.radiusKm;
      delete next.district;
      if (next.sort === "distance") delete next.sort;
      break;
    case "district":
      delete next.district;
      break;
    case "price":
      delete next.priceMin;
      delete next.priceMax;
      break;
    case "sellerType":
      delete next.sellerType;
      break;
    case "seller":
      delete next.sellerId;
      break;
    case "shop":
      delete next.shop;
      delete next.sellerType;
      break;
    case "donation":
      delete next.donation;
      break;
    case "withPhoto":
      delete next.withPhoto;
      break;
    case "includeSoldOut":
      delete next.includeSoldOut;
      break;
    case "promo":
      delete next.promo;
      if (next.sort === "discount") delete next.sort;
      break;
    case "conditions":
      delete next.conditions;
      break;
    case "dates":
      delete next.dates;
      break;
    case "route":
      delete next.route;
      break;
  }
  return canonicalSearchParams(next);
}

/** Every filter off; the words and the sort stay (Leboncoin's "Effacer les filtres"). */
export function clearFilters(params: SearchParams): SearchParams {
  return canonicalSearchParams({ q: params.q, raw: params.raw, sort: params.sort });
}

/** Active filters in display order (the words are in the search bar, not a chip). */
export function activeFilterKeys(params: SearchParams): FilterKey[] {
  const keys: FilterKey[] = [];
  if (params.category) keys.push("category");
  if (params.dates) keys.push("dates");
  if (params.city || params.region || params.zone) keys.push("location");
  if (params.route) keys.push("route");
  if (params.district) keys.push("district");
  if (params.priceMin !== undefined || params.priceMax !== undefined) keys.push("price");
  if (params.shop) keys.push("shop");
  else if (params.sellerType) keys.push("sellerType");
  if (params.sellerId) keys.push("seller");
  if (params.donation) keys.push("donation");
  if (params.withPhoto) keys.push("withPhoto");
  if (params.includeSoldOut) keys.push("includeSoldOut");
  if (params.promo) keys.push("promo");
  if (params.conditions?.length) keys.push("conditions");
  for (const id of Object.keys(params.criteria ?? {})) keys.push(`criterion:${id}`);
  return keys;
}

export function countFilters(params: SearchParams): number {
  return activeFilterKeys(params).length;
}

/** A criterion value with its unit ("120 000 km", "2019" for a year). */
function formatValue(value: number, unit: CriterionUnit | undefined, labels: FilterLabels): string {
  const digits = unit === "an" ? String(value) : `${value < 0 ? "-" : ""}${groupDigits(String(Math.abs(value))) || "0"}`;
  return unit && unit !== "an" ? `${digits} ${labels.unit(unit)}` : digits;
}

/** At most two values written out, then "+n". */
function joinValues(values: string[], labels: FilterLabels): string {
  if (values.length <= 2) return values.join(labels.separator);
  return `${values.slice(0, 2).join(labels.separator)} +${values.length - 2}`;
}

function rangeLabel(label: string, min: string | undefined, max: string | undefined, labels: FilterLabels): string {
  if (min !== undefined && max !== undefined) return labels.chip("range", { label, min, max });
  if (min !== undefined) return labels.chip("rangeFrom", { label, min });
  return labels.chip("rangeTo", { label, max: max ?? "" });
}

function criterionLabel(id: string, filter: CriterionFilter, labels: FilterLabels): string {
  const criterion = criterionById(id);
  const label = labels.criterion(id);
  if (filter.kind === "flag") return label;
  if (filter.kind === "options") return labels.chip("options", { label, values: joinValues(filter.values.map((value) => labels.option(id, value)), labels) });
  const unit = criterion?.unit;
  return rangeLabel(
    label,
    filter.min === undefined ? undefined : formatValue(filter.min, unit, labels),
    filter.max === undefined ? undefined : formatValue(filter.max, unit, labels),
    labels,
  );
}

/** Title-cases a Latin district key ("maarif" -> "Maarif"); Arabic keys are left as they are. */
export function districtLabel(key: string): string {
  return key.replace(/(^|\s)(\p{Ll})/gu, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}

function filterLabel(params: SearchParams, key: FilterKey, locale: Locale, labels: FilterLabels): string {
  if (key.startsWith("criterion:")) {
    const id = key.slice("criterion:".length);
    const filter = params.criteria?.[id];
    return filter ? criterionLabel(id, filter, labels) : id;
  }
  switch (key) {
    case "category": {
      const category = params.category ?? "";
      return params.subcategory ? labels.subcategory(category, params.subcategory) : labels.category(category);
    }
    case "location": {
      if (params.zone) return labels.chip("zone", { km: String(params.zone.km) });
      const place = locationName({ city: params.city, region: params.region }, locale) ?? "";
      return params.radiusKm ? labels.chip("radius", { place, km: String(params.radiusKm) }) : place;
    }
    case "district":
      return labels.chip("district", { district: districtLabel(params.district ?? "") });
    case "price": {
      const min = params.priceMin === undefined ? undefined : formatPrice(params.priceMin, locale);
      const max = params.priceMax === undefined ? undefined : formatPrice(params.priceMax, locale);
      if (min !== undefined && max !== undefined) return labels.chip("priceRange", { min, max });
      if (min !== undefined) return labels.chip("priceFrom", { min });
      return labels.chip("priceTo", { max: max ?? "" });
    }
    case "sellerType":
      return labels.chip(params.sellerType === "pro" ? "sellerPro" : "sellerIndividual");
    case "seller":
      return labels.chip("seller");
    case "shop":
      return labels.chip("shop");
    case "donation":
      return labels.chip("donation");
    case "withPhoto":
      return labels.chip("withPhoto");
    case "includeSoldOut":
      return labels.chip("includeSoldOut");
    case "promo":
      return labels.chip("promo");
    case "conditions":
      return labels.chip("conditions", { values: joinValues((params.conditions ?? []).map((value) => labels.condition(value)), labels) });
    case "dates": {
      if (!params.dates) return key;
      const day = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });
      const at = (value: string) => day.format(new Date(`${value}T12:00:00Z`));
      const nights = datedRental(params.subcategory)?.unit === "night";
      return nights ? labels.chip("datesNights", { from: at(params.dates.from), to: at(params.dates.to), days: rentalDuration(params.dates) }) : labels.chip("dates", { from: at(params.dates.from), to: at(params.dates.to), days: rentalDuration(params.dates) });
    }
    case "route":
      return params.route ? routeLabel(params, locale, labels) : key;
  }
  return key;
}

/**
 * A carrier route in its direction (« Nord (France) → Oujda »): the EU zone (with its country) or
 * the country, and the Moroccan city; one side alone when the other is open.
 */
function routeLabel(params: SearchParams, locale: Locale, labels: FilterLabels): string {
  const route = params.route ?? {};
  const zone = route.zone ? euZoneById(route.zone) : null;
  const code = zone?.country ?? route.country;
  const country = code ? (new Intl.DisplayNames([intlLocale(locale)], { type: "region" }).of(code) ?? code) : undefined;
  const europe = zone ? `${zone.name} (${country})` : country;
  const city = route.city ? cityBySlug(route.city) : undefined;
  const morocco = city ? cityName(city, locale) : undefined;
  const direction = params.criteria?.["departure-direction"];
  const toEurope = direction?.kind === "options" && direction.values.length === 1 && direction.values[0] === "maroc-europe";
  const [from, to] = toEurope ? [morocco, europe] : [europe, morocco];
  return from && to ? labels.chip("route", { from, to }) : (from ?? to ?? "");
}

/** The active filters as chips: label + the search without it. */
export function describeFilters(params: SearchParams, locale: Locale, labels: FilterLabels): ActiveFilter[] {
  return activeFilterKeys(params).map((key) => ({ key, label: filterLabel(params, key, locale, labels), without: withoutFilter(params, key) }));
}

/** Sorts that make sense for this search: relevance needs words, distance a city or a map zone (D6). */
export function sortOptions(params: Pick<SearchParams, "q" | "city" | "zone" | "promo">): SearchSort[] {
  const sorts: SearchSort[] = [];
  if (params.q) sorts.push("relevance");
  sorts.push("recent", "price_asc", "price_desc");
  // « Plus forte réduction » ranks the running promotions: offered once the filter keeps only them.
  if (params.promo) sorts.push("discount");
  if (params.city || params.zone) sorts.push("distance");
  return sorts;
}

/** The search with another sort, back to page 1. */
export function withSort(params: SearchParams, sort: SearchSort): SearchParams {
  return canonicalSearchParams({ ...params, sort, page: undefined });
}

export type PageItem = number | "gap";

/**
 * Page numbers to show: the first, the last and a window around the current one, gaps as
 * "gap". Capped at SEARCH_MAX_PAGE (§6: 50 pages of 24).
 */
export function paginationItems(page: number, totalPages: number, window = 1): PageItem[] {
  const last = Math.min(Math.max(totalPages, 1), SEARCH_MAX_PAGE);
  const current = Math.min(Math.max(page, 1), last);
  const pages = new Set<number>([1, last]);
  for (let n = current - window; n <= current + window; n += 1) if (n >= 1 && n <= last) pages.add(n);
  // A gap of a single page shows that page instead.
  const sorted = [...pages].sort((a, b) => a - b);
  const items: PageItem[] = [];
  for (const [index, n] of sorted.entries()) {
    const previous = sorted[index - 1];
    if (previous !== undefined && n - previous === 2) items.push(previous + 1);
    else if (previous !== undefined && n - previous > 2) items.push("gap");
    items.push(n);
  }
  return items;
}

export function withPage(params: SearchParams, page: number): SearchParams {
  return canonicalSearchParams({ ...params, page });
}

export interface Refinement {
  kind: "category" | "subcategory";
  id: string;
  categoryId: string;
  count: number;
  params: SearchParams;
}

/**
 * Next refinement step from the facet counts: the categories while none is chosen, then the
 * subcategories of the chosen category. Only values with listings, in the tree order.
 */
export function refinements(params: SearchParams, facets: SearchFacets | undefined): Refinement[] {
  if (!facets) return [];
  if (!params.category) {
    return CATEGORIES.filter((category) => (facets.categories[category.id] ?? 0) > 0).map((category) => ({
      kind: "category" as const,
      id: category.id,
      categoryId: category.id,
      count: facets.categories[category.id] ?? 0,
      params: canonicalSearchParams({ ...params, category: category.id, page: undefined }),
    }));
  }
  if (params.subcategory) return [];
  const category = categoryById(params.category);
  return (category?.subcategories ?? [])
    .filter((sub) => (facets.subcategories[sub.id] ?? 0) > 0)
    .map((sub) => ({
      kind: "subcategory" as const,
      id: sub.id,
      categoryId: sub.categoryId,
      count: facets.subcategories[sub.id] ?? 0,
      params: canonicalSearchParams({ ...params, subcategory: sub.id, page: undefined }),
    }));
}

export type Widening = { kind: "region"; code: string; params: SearchParams } | { kind: "country"; params: SearchParams };

/** Broader places for an empty result: the city's region, then the whole country. */
export function widenings(params: SearchParams): Widening[] {
  const out: Widening[] = [];
  const city = params.city ? cityBySlug(params.city) : undefined;
  const base: SearchParams = { ...params, page: undefined, city: undefined, radiusKm: undefined, district: undefined, region: undefined, zone: undefined };
  if (base.sort === "distance") delete base.sort;
  if (city && regionByCode(city.regionCode)) out.push({ kind: "region", code: city.regionCode, params: canonicalSearchParams({ ...base, region: city.regionCode }) });
  if (params.city || params.region || params.zone) out.push({ kind: "country", params: canonicalSearchParams(base) });
  return out;
}

/** Shifts of a dated rental search with no result (audit L4-10): the same length, earlier or later. */
const DATE_SHIFTS = [-7, -2, 2, 7];

/** The same search on nearby dates (none in the past), then without dates; [] without dates. */
export function nearbyDates(params: SearchParams, today: number): { from: string; to: string; params: SearchParams }[] {
  if (!params.dates || !datedRental(params.subcategory)) return [];
  const from = dayNumber(params.dates.from);
  const to = dayNumber(params.dates.to);
  return DATE_SHIFTS.filter((shift) => from + shift >= today).map((shift) => {
    const dates = { from: dayString(from + shift), to: dayString(to + shift) };
    return { ...dates, params: canonicalSearchParams({ ...params, page: undefined, dates }) };
  });
}

/** Subcategory of the search, when it declares a `condition` field: the condition filter applies. */
export function conditionApplies(params: Pick<SearchParams, "subcategory">): boolean {
  if (!params.subcategory) return true;
  return Boolean(subcategoryById(params.subcategory)?.condition);
}

/** Criteria the search can filter on (text criteria are searched as words, never filtered). */
export function filterableCriteria(categoryId: string | undefined, subcategoryId: string | undefined) {
  return searchCriteria(categoryId, subcategoryId);
}

/** Sets or clears one criterion filter; undefined when none remains. */
export function setCriterion(criteria: Record<string, CriterionFilter> | undefined, id: string, filter: CriterionFilter | undefined): Record<string, CriterionFilter> | undefined {
  const next = { ...criteria };
  const empty =
    !filter ||
    (filter.kind === "options" && filter.values.length === 0) ||
    (filter.kind === "range" && filter.min === undefined && filter.max === undefined);
  if (empty) delete next[id];
  else next[id] = filter;
  return Object.keys(next).length ? next : undefined;
}

/** Messages of `SearchPage.title`. */
export type TitleKey = "all" | "query" | "inCity" | "inRegion" | "inZone";

/** Heading of a search: the words, else the (sub)category, else "all listings"; then the place. */
export function searchTitle(params: SearchParams, locale: Locale, labels: FilterLabels, title: (key: TitleKey, values?: Record<string, string>) => string): string {
  const what = params.q
    ? title("query", { query: params.q })
    : params.subcategory
      ? labels.subcategory(params.category ?? subcategoryById(params.subcategory)?.categoryId ?? "", params.subcategory)
      : params.category
        ? labels.category(params.category)
        : title("all");
  if (params.zone) return title("inZone", { what });
  const city = params.city ? cityBySlug(params.city) : undefined;
  if (city) return title("inCity", { what, place: cityName(city, locale) });
  const region = params.region ? regionByCode(params.region) : undefined;
  if (region) return title("inRegion", { what, place: regionName(region, locale) });
  return what;
}

export type CardBadge = "featured" | "bumped";

/** §8 mention of a card: À la Une when served in a slot, else Remontée for a paid bump. */
export function cardBadge(card: Pick<SearchCard, "featured" | "bumped">): CardBadge | undefined {
  if (card.featured) return "featured";
  if (card.bumped) return "bumped";
  return undefined;
}

/** « Neuf » and « Occasion » of the quick condition switch (audit §7): new with tags, or anything worn. */
export const QUICK_CONDITIONS: { new: readonly Condition[]; used: readonly Condition[] } = {
  new: ["new_tagged"],
  used: CONDITIONS.filter((condition) => condition !== "new_tagged"),
};

export type QuickCondition = "all" | keyof typeof QUICK_CONDITIONS;

export interface QuickConditionChoice {
  value: QuickCondition;
  params: SearchParams;
}

/** Whether the scope of the search holds listings with a condition (a category: one of its subcategories). */
export function quickConditionApplies(params: Pick<SearchParams, "category" | "subcategory">): boolean {
  if (params.subcategory) return Boolean(subcategoryById(params.subcategory)?.condition);
  if (!params.category) return true;
  return (categoryById(params.category)?.subcategories ?? []).some((sub) => Boolean(sub.condition));
}

/** The switch's selected value: null when the filters sheet picked another set of conditions. */
export function quickConditionOf(params: Pick<SearchParams, "conditions">): QuickCondition | null {
  const chosen = params.conditions ?? [];
  if (chosen.length === 0) return "all";
  for (const value of ["new", "used"] as const) {
    const set = QUICK_CONDITIONS[value];
    if (chosen.length === set.length && set.every((condition) => chosen.includes(condition))) return value;
  }
  return null;
}

/** The three searches of the switch (first page, other filters kept); none when the scope has no condition. */
export function quickConditions(params: SearchParams): QuickConditionChoice[] {
  if (!quickConditionApplies(params)) return [];
  return (["all", "new", "used"] as const).map((value) => ({
    value,
    params: canonicalSearchParams({ ...params, page: undefined, conditions: value === "all" ? undefined : [...QUICK_CONDITIONS[value]] }),
  }));
}
