import "server-only";
import { createHash } from "node:crypto";
import { logger } from "@/lib/logging/logger";
import { searchEngine } from "@/lib/search/engine";
import { attributeField, type EngineQuery, type FilterExpr, type SearchEngine } from "@/lib/search/types";
import { isValkeyConfigured, valkey } from "@/lib/valkey/clients";
import {
  PRICE_GUIDE_MAX_PRICES,
  PRICE_GUIDE_SCOPES,
  PRICE_GUIDE_TTL_SECONDS,
  comparableSpec,
  comparableStats,
  specKey,
  type ComparableSpec,
  type GuideListing,
  type PriceGuide,
  type PriceGuideScope,
} from "./rules";

// « Prix repère » engine side (Carte vivante lot 5): the comparables come from the search index
// (published, visible listings only, src/lib/search/document.ts), never from Firestore. One
// multi-search round trip asks the city, the region and Morocco at once (the most recent first;
// PRICE_GUIDE_MAX_PRICES + 1 hits each, since the listing itself may be among them); the first area
// with enough comparables wins, each seller counting twice at most (rules.ts). Example listings and
// the listing itself are dropped from the hits in code (so the guide never depends on the index
// settings), donations and sold-out Pro listings by the filter. The hits of the three areas are
// kept 24 h in valkey-ratelimit (allkeys-lru: a cache may be evicted, never the queue's jobs),
// keyed by the comparables' description and the area, not by listing: every listing described the
// same way in the same city reads one entry (an edited or moved listing reads another), and each
// gets its own guide from it, without itself. The hits of a listing's own guide are exactly those
// the engine would return with the listing filtered out: the top of a sorted list, less one entry.

export interface GuideSubject extends GuideListing {
  id: string;
  citySlug: string;
  regionCode: string;
}

/** Fields read per hit: the id (the listing itself is left out), the price, its seller (per-seller cap) and the example mark. */
const HIT_FIELDS = ["id", "price", "isExample", "sellerPublicId"] as const;

/** One engine hit, as cached: [id, price, seller, example?]. A hit without a price or a seller keeps its place and counts for nothing. */
export type ComparableHit = [id: string, price: number | null, seller: string, example?: 1];

/** The hits of the three areas, most recent first, PRICE_GUIDE_MAX_PRICES + 1 at most each. */
export type ComparableHits = Record<PriceGuideScope, ComparableHit[]>;

function criteriaFilters(spec: ComparableSpec): FilterExpr[] {
  return [
    ...Object.entries(spec.equals).map(([id, value]): FilterExpr => ({ field: attributeField(id), op: "eq", value })),
    ...Object.entries(spec.ranges).flatMap(([id, range]): FilterExpr[] => [
      { field: attributeField(id), op: "gte", value: range.min },
      { field: attributeField(id), op: "lte", value: range.max },
    ]),
  ];
}

function areaFilter(scope: PriceGuideScope, subject: Pick<GuideSubject, "citySlug" | "regionCode">): FilterExpr[] {
  if (scope === "city") return [{ field: "citySlug", op: "eq", value: subject.citySlug }];
  if (scope === "region") return [{ field: "regionCode", op: "eq", value: subject.regionCode }];
  return [];
}

/** The engine query of one area (exported for the tests). */
export function comparablesQuery(spec: ComparableSpec, subject: Pick<GuideSubject, "citySlug" | "regionCode">, scope: PriceGuideScope): EngineQuery {
  return {
    q: spec.text,
    filter: {
      and: [
        { field: "subcategoryId", op: "eq", value: spec.subcategoryId },
        ...areaFilter(scope, subject),
        { field: "price", op: "gt", value: 0 },
        { field: "isDonation", op: "eq", value: false },
        { not: { field: "soldOut", op: "eq", value: true } },
        ...criteriaFilters(spec),
      ],
    },
    sort: [{ field: "sortAt", dir: "desc" }],
    page: 1,
    hitsPerPage: PRICE_GUIDE_MAX_PRICES + 1,
    fields: HIT_FIELDS,
  };
}

/** The hits of every area (no cache): one multi-search round trip. */
export async function fetchComparables(spec: ComparableSpec, subject: Pick<GuideSubject, "citySlug" | "regionCode">, engine: SearchEngine): Promise<ComparableHits> {
  // Region and Morocco are the same area when the city is unknown to the index: still asked, cheap.
  const results = await engine.search(PRICE_GUIDE_SCOPES.map((scope) => comparablesQuery(spec, subject, scope)));
  const hits = { city: [], region: [], country: [] } as ComparableHits;
  for (const [index, scope] of PRICE_GUIDE_SCOPES.entries()) {
    const raw = (results[index]?.hits ?? []) as { id?: string; price?: number; isExample?: boolean; sellerPublicId?: string }[];
    hits[scope] = raw.map((hit): ComparableHit => {
      const kept: ComparableHit = [String(hit.id ?? ""), typeof hit.price === "number" ? hit.price : null, typeof hit.sellerPublicId === "string" ? hit.sellerPublicId : ""];
      if (hit.isExample === true) kept.push(1);
      return kept;
    });
  }
  return hits;
}

/** The place an area is named after. */
const placeOf = (scope: PriceGuideScope, subject: GuideSubject) => (scope === "city" ? subject.citySlug : scope === "region" ? subject.regionCode : "ma");

/**
 * The guide of `subject` from the hits of its areas: the first area with enough comparables, the
 * listing itself left out, PRICE_GUIDE_MAX_PRICES hits read, examples and priceless hits ignored.
 */
export function guideFromHits(hits: ComparableHits, subject: GuideSubject): PriceGuide | null {
  for (const scope of PRICE_GUIDE_SCOPES) {
    const comparables = hits[scope]
      .filter(([id]) => id !== subject.id)
      .slice(0, PRICE_GUIDE_MAX_PRICES)
      .flatMap(([, price, seller, example]) => (example !== 1 && typeof price === "number" ? [{ price, seller }] : []));
    const stats = comparableStats(comparables);
    if (stats) return { ...stats, scope, place: placeOf(scope, subject) };
  }
  return null;
}

/** Computes the guide (no cache). Null: no guide for this listing, or too few comparables everywhere. */
export async function computePriceGuide(subject: GuideSubject, engine: SearchEngine = searchEngine()): Promise<PriceGuide | null> {
  const spec = comparableSpec(subject);
  if (!spec) return null;
  return guideFromHits(await fetchComparables(spec, subject, engine), subject);
}

// ---- Cache --------------------------------------------------------------------------------------

export interface GuideCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** What one cache entry holds. */
interface CachedHits {
  v: 1;
  hits: ComparableHits;
}

let override: GuideCache | null | undefined;

/** Tests only: a cache in place of Valkey (null: none; undefined: the configured one). */
export function setPriceGuideCacheForTests(cache: GuideCache | null | undefined): void {
  override = cache;
}

/** A cache call never holds a page render for long. */
const CACHE_TIMEOUT_MS = 300;

function timed<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("price guide cache timeout")), CACHE_TIMEOUT_MS))]);
}

function guideCache(): GuideCache | null {
  if (override !== undefined) return override;
  if (!isValkeyConfigured("ratelimit")) return null;
  const client = valkey("ratelimit");
  // The client is lazy and refuses commands before it is ready (no offline queue): connect first.
  const ready = async () => {
    if (client.status === "wait") await client.connect().catch(() => undefined);
  };
  return {
    get: (key) => timed(ready().then(() => client.get(key))),
    set: async (key, value, ttl) => {
      await timed(ready().then(() => client.set(key, value, "EX", ttl)));
    },
  };
}

/** Key of a listing that gets no guide at all (donation, no price, excluded subcategory, example). */
const NO_GUIDE = "-";

/** What a subject's guide depends on: its comparables and its area (a listing moved to another city changes it). */
export function subjectKey(subject: GuideSubject): string {
  const spec = comparableSpec(subject);
  return spec ? `${specKey(spec)}|${subject.citySlug}|${subject.regionCode}` : NO_GUIDE;
}

/** v3: the hits by comparables and area, shared by the listings of one description (v2 entries, by listing, are left to expire). */
export function priceGuideCacheKey(subject: GuideSubject): string {
  return `pg:v3:${createHash("sha256").update(subjectKey(subject)).digest("base64url").slice(0, 32)}`;
}

const isHit = (value: unknown): value is ComparableHit =>
  Array.isArray(value) && typeof value[0] === "string" && (typeof value[1] === "number" || value[1] === null) && typeof value[2] === "string";

/** The entry of `key`, or null (none, unreadable, Valkey down). */
async function cachedHits(key: string): Promise<ComparableHits | null> {
  const cache = guideCache();
  if (!cache) return null;
  try {
    const raw = await cache.get(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedHits>;
    if (value.v !== 1 || typeof value.hits !== "object" || value.hits === null) return null;
    const hits = { city: [], region: [], country: [] } as ComparableHits;
    for (const scope of PRICE_GUIDE_SCOPES) {
      const list: unknown = value.hits[scope];
      if (!Array.isArray(list) || !list.every(isHit)) return null;
      hits[scope] = list;
    }
    return hits;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "price guide: cache unavailable");
    return null;
  }
}

async function storeHits(key: string, hits: ComparableHits): Promise<void> {
  const cache = guideCache();
  if (!cache) return;
  try {
    const entry: CachedHits = { v: 1, hits };
    await cache.set(key, JSON.stringify(entry), PRICE_GUIDE_TTL_SECONDS);
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "price guide: not cached");
  }
}

/**
 * The guide of a listing, from the cached hits of its comparables and area when there are some,
 * else fetched and cached. Never throws: the engine down or misconfigured means no guide, not
 * cached (logged). A listing that gets no guide at all asks nothing.
 */
export async function priceGuideFor(subject: GuideSubject, engine?: SearchEngine): Promise<PriceGuide | null> {
  const spec = comparableSpec(subject);
  if (!spec) return null;
  const key = priceGuideCacheKey(subject);
  let hits = await cachedHits(key);
  if (!hits) {
    try {
      hits = await fetchComparables(spec, subject, engine ?? searchEngine());
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "price guide: engine unavailable");
      return null;
    }
    await storeHits(key, hits);
  }
  return guideFromHits(hits, subject);
}
