import { CARRIER_DIRECTIONS, CARRIER_ITEM_IDS, CARRIER_SEARCH, EU_ZONE_COUNTRIES, euZoneById, isEuZone, type CarrierDirection, type CarrierItem, type EuZoneCountry } from "@/config/carriers";
import { cityBySlug } from "@/config/regions";
import { dayNumber, DAY_PATTERN } from "@/lib/listings/rental-availability";
import type { Basket } from "./estimate";

// The query string of /transporteurs (transporteurs/spec.md §5): the route, the period, the basket
// and the order. The URL is the whole state (a shared link shows the same search); anything
// unknown or out of bounds is dropped, never an error. Client-safe.

export const CARRIERS_PATH = "/transporteurs";

export const CARRIER_SORTS = ["date", "price", "rating"] as const;
export type CarrierSort = (typeof CARRIER_SORTS)[number];

export interface CarrierSearchParams {
  direction: CarrierDirection;
  /** EU side: a country, or one of its zones (`FR-69`). */
  country?: EuZoneCountry;
  zone?: string;
  /** Moroccan side: a city slug. */
  city?: string;
  /** Departure days, `YYYY-MM-DD`; absent: today to CARRIER_SEARCH.windowDays ahead. */
  from?: string;
  to?: string;
  /** « Complet » departures too (left out by default). */
  full?: boolean;
  /** Loose kilograms and catalogue items; empty: no estimate, the cards show « dès X le kg ». */
  kg?: number;
  items?: Partial<Record<CarrierItem, number>>;
  pickup?: boolean;
  delivery?: boolean;
  sort: CarrierSort;
}

/** URL keys, in French like the rest of the site's (« sens=europe-maroc »). */
const KEYS = { direction: "sens", country: "pays", zone: "zone", city: "ville", from: "du", to: "au", full: "complets", kg: "kg", items: "objets", pickup: "collecte", delivery: "livraison", sort: "tri" } as const;
const DIRECTION_SLUGS: Record<CarrierDirection, string> = { eu_ma: "europe-maroc", ma_eu: "maroc-europe" };
const SORT_SLUGS: Record<CarrierSort, string> = { date: "date", price: "prix", rating: "note" };

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

function read(raw: Raw, key: string): string | undefined {
  const value = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length <= 200 ? first.trim() : undefined;
}

const isDay = (value: string | undefined): value is string => value !== undefined && DAY_PATTERN.test(value) && Number.isFinite(dayNumber(value));

function readCount(text: string | undefined, max: number): number | undefined {
  if (!text || !/^\d{1,5}$/.test(text)) return undefined;
  const value = Number(text);
  return value > 0 && value <= max ? value : undefined;
}

/** `suitcase.2,e-scooter.1` → the items with a count from 1 to CARRIER_SEARCH.itemMax. */
function readItems(text: string | undefined): Partial<Record<CarrierItem, number>> | undefined {
  if (!text) return undefined;
  const items: Partial<Record<CarrierItem, number>> = {};
  for (const part of text.split(",").slice(0, CARRIER_ITEM_IDS.length)) {
    const [id, count] = part.split(".");
    const value = readCount(count, CARRIER_SEARCH.itemMax);
    if (id && (CARRIER_ITEM_IDS as string[]).includes(id) && value) items[id as CarrierItem] = value;
  }
  return Object.keys(items).length > 0 ? items : undefined;
}

export function parseCarrierSearch(raw: Raw): CarrierSearchParams {
  const directionSlug = read(raw, KEYS.direction);
  const direction = CARRIER_DIRECTIONS.find((id) => DIRECTION_SLUGS[id] === directionSlug) ?? "eu_ma";
  const zoneId = read(raw, KEYS.zone);
  const zone = zoneId && isEuZone(zoneId) ? zoneId : undefined;
  const countryCode = read(raw, KEYS.country);
  const country = zone ? euZoneById(zone)!.country : (EU_ZONE_COUNTRIES as string[]).includes(countryCode ?? "") ? (countryCode as EuZoneCountry) : undefined;
  const citySlug = read(raw, KEYS.city);
  const from = read(raw, KEYS.from);
  const to = read(raw, KEYS.to);
  const sortSlug = read(raw, KEYS.sort);
  return {
    direction,
    ...(country ? { country } : {}),
    ...(zone ? { zone } : {}),
    ...(citySlug && cityBySlug(citySlug) ? { city: citySlug } : {}),
    ...(isDay(from) ? { from } : {}),
    ...(isDay(to) && (!isDay(from) || to >= from) ? { to } : {}),
    ...(read(raw, KEYS.full) === "1" ? { full: true } : {}),
    ...(readCount(read(raw, KEYS.kg), CARRIER_SEARCH.kgMax) ? { kg: readCount(read(raw, KEYS.kg), CARRIER_SEARCH.kgMax) } : {}),
    ...(readItems(read(raw, KEYS.items)) ? { items: readItems(read(raw, KEYS.items)) } : {}),
    ...(read(raw, KEYS.pickup) === "1" ? { pickup: true } : {}),
    ...(read(raw, KEYS.delivery) === "1" ? { delivery: true } : {}),
    sort: CARRIER_SORTS.find((id) => SORT_SLUGS[id] === sortSlug) ?? "date",
  };
}

/** The query string of a search (defaults left out), without « ? ». */
export function carrierSearchQuery(params: CarrierSearchParams): string {
  const query = new URLSearchParams();
  if (params.direction !== "eu_ma") query.set(KEYS.direction, DIRECTION_SLUGS[params.direction]);
  if (params.zone) query.set(KEYS.zone, params.zone);
  else if (params.country) query.set(KEYS.country, params.country);
  if (params.city) query.set(KEYS.city, params.city);
  if (params.from) query.set(KEYS.from, params.from);
  if (params.to) query.set(KEYS.to, params.to);
  if (params.full) query.set(KEYS.full, "1");
  if (params.kg) query.set(KEYS.kg, String(params.kg));
  const items = Object.entries(params.items ?? {}).filter(([, count]) => count && count > 0);
  if (items.length > 0) query.set(KEYS.items, items.map(([id, count]) => `${id}.${count}`).join(","));
  if (params.pickup) query.set(KEYS.pickup, "1");
  if (params.delivery) query.set(KEYS.delivery, "1");
  if (params.sort !== "date") query.set(KEYS.sort, SORT_SLUGS[params.sort]);
  return query.toString();
}

export function carrierSearchPath(params: CarrierSearchParams): string {
  const query = carrierSearchQuery(params);
  return query ? `${CARRIERS_PATH}?${query}` : CARRIERS_PATH;
}

/** The basket of a search, or null when it holds nothing (no estimate then). */
export function basketOf(params: CarrierSearchParams): Basket | null {
  const items = params.items ?? {};
  if (!params.kg && Object.keys(items).length === 0) return null;
  return { kg: params.kg ?? 0, items, options: { pickup: Boolean(params.pickup), delivery: Boolean(params.delivery) } };
}
