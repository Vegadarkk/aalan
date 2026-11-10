import "server-only";
import { CARRIER_SEARCH } from "@/config/carriers";
import { DEPARTURE_SUBCATEGORY } from "@/config/categories";
import type { CarrierSearchResponse, CarrierSummary, DepartureCard, RouteGuide } from "@/lib/contracts/carrier-search";
import { dayNumber, dayString, moroccoToday } from "@/lib/listings/rental-availability";
import { searchEngine } from "@/lib/search/engine";
import { attributeField, type FilterExpr, type SearchDeparture } from "@/lib/search/types";
import { carrierShops, type CarrierShop } from "./directory";
import { estimate } from "./estimate";
import { basketOf, type CarrierSearchParams } from "./search-params";

// The departures of /transporteurs (transporteurs/spec.md §5): one engine query in date order on
// the route and the period, then each departure joined to its carrier (shops whose storefront is
// shown, with a price list), priced from the basket and sorted. The guide shows the spread of the
// base rates once enough carriers serve the route.

const FIELDS = ["id", "slugId", "sellerPublicId", "departure", "depOn"] as const;

interface DepartureHit {
  id: string;
  slugId: string;
  sellerPublicId: string;
  departure?: SearchDeparture;
  depOn?: number;
}

/** The days searched: the period asked, clipped to today onwards; by default the next window. */
export function searchDays(params: Pick<CarrierSearchParams, "from" | "to">, now: Date): { from: number; to: number } {
  const today = moroccoToday(now);
  const from = Math.max(today, params.from ? dayNumber(params.from) : today);
  const to = params.to ? Math.max(from, dayNumber(params.to)) : from + CARRIER_SEARCH.windowDays;
  return { from, to };
}

export function departureFilter(params: CarrierSearchParams, now: Date): FilterExpr {
  const { from, to } = searchDays(params, now);
  const parts: FilterExpr[] = [
    { field: "subcategoryId", op: "eq", value: DEPARTURE_SUBCATEGORY },
    { field: attributeField("departure-direction"), op: "eq", value: params.direction === "eu_ma" ? "europe-maroc" : "maroc-europe" },
    { field: "depOn", op: "gte", value: from },
    { field: "depOn", op: "lte", value: to },
  ];
  if (params.zone) parts.push({ field: "depZones", op: "eq", value: params.zone });
  else if (params.country) parts.push({ field: "depCountries", op: "eq", value: params.country });
  if (params.city) parts.push({ field: "depCities", op: "eq", value: params.city });
  if (!params.full) parts.push({ not: { field: "depSpace", op: "eq", value: "full" } });
  return { and: parts };
}

function summaryOf(publicId: string, shop: CarrierShop): CarrierSummary {
  const { tariff } = shop.carrier;
  return {
    publicId,
    name: shop.name,
    segment: shop.segment,
    ...(shop.logo ? { logo: shop.logo } : {}),
    verified: shop.verified,
    rating: shop.rating,
    from: { perKg: Math.min(tariff.perKg, ...tariff.bands.map((band) => band.perKg)), currency: tariff.currency },
    settings: shop.carrier,
  };
}

/** An amount in euro cents for ordering only (CARRIER_SEARCH.madPerEurForOrdering). */
const orderValue = (amount: number, currency: "EUR" | "MAD") => (currency === "MAD" ? amount / CARRIER_SEARCH.madPerEurForOrdering : amount);

function priceOf(card: DepartureCard): number {
  return card.estimate ? orderValue(card.estimate.total, card.estimate.currency) : orderValue(card.carrier.from.perKg, card.carrier.from.currency);
}

export function sortCards(cards: DepartureCard[], sort: CarrierSearchParams["sort"]): DepartureCard[] {
  const byDate = (a: DepartureCard, b: DepartureCard) => a.departure.departOn.localeCompare(b.departure.departOn);
  const byPrice = (a: DepartureCard, b: DepartureCard) => priceOf(a) - priceOf(b);
  const byRating = (a: DepartureCard, b: DepartureCard) => (b.carrier.rating?.avg ?? 0) - (a.carrier.rating?.avg ?? 0) || (b.carrier.rating?.count ?? 0) - (a.carrier.rating?.count ?? 0);
  const order = sort === "price" ? [byPrice, byDate] : sort === "rating" ? [byRating, byDate, byPrice] : [byDate, byPrice];
  return [...cards].sort((a, b) => {
    for (const compare of order) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return a.id.localeCompare(b.id);
  });
}

/** The spread of the carriers' base rates in the results, in the currency most of them use. */
export function routeGuide(cards: readonly DepartureCard[]): RouteGuide | null {
  const carriers = new Map<string, CarrierSummary>();
  for (const card of cards) carriers.set(card.carrier.publicId, card.carrier);
  for (const currency of ["EUR", "MAD"] as const) {
    const rates = [...carriers.values()].filter((carrier) => carrier.settings.tariff.currency === currency).map((carrier) => carrier.settings.tariff.perKg);
    if (rates.length >= CARRIER_SEARCH.guideMinCarriers) return { currency, min: Math.min(...rates), max: Math.max(...rates), carriers: rates.length };
  }
  return null;
}

export async function searchDepartures(params: CarrierSearchParams, now = new Date()): Promise<CarrierSearchResponse> {
  const [result] = await searchEngine().search([{ q: "", filter: departureFilter(params, now), sort: [{ field: "depOn", dir: "asc" }], page: 1, hitsPerPage: CARRIER_SEARCH.hitsMax, fields: FIELDS }]);
  if (!result || result.totalHits === 0) return { departures: [], total: 0, guide: null };
  const shops = await carrierShops(now.getTime());
  const basket = basketOf(params);
  const cards: DepartureCard[] = [];
  for (const hit of result.hits as unknown as DepartureHit[]) {
    const shop = shops.get(hit.sellerPublicId);
    if (!shop || !hit.departure) continue;
    cards.push({ id: hit.id, slugId: hit.slugId, departure: hit.departure, carrier: summaryOf(hit.sellerPublicId, shop), estimate: basket ? estimate(shop.carrier.tariff, basket) : null });
  }
  return { departures: sortCards(cards, params.sort), total: result.totalHits, guide: routeGuide(cards) };
}

/** The first and last day searched, as `YYYY-MM-DD` (the form's dates). */
export function searchPeriod(params: Pick<CarrierSearchParams, "from" | "to">, now: Date): { from: string; to: string } {
  const { from, to } = searchDays(params, now);
  return { from: dayString(from), to: dayString(to) };
}
