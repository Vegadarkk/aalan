import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { listingStatsRef } from "@/lib/db/repositories/listing-stats";
import { listingRef } from "@/lib/db/repositories/listings";
import { COLLECTIONS, type ShopStatsDay } from "@/lib/db/schemas";
import { db, isFirebaseConfigured } from "@/lib/firebase/admin";
import { logger } from "@/lib/logging/logger";
import { consume, firstDegraded } from "@/lib/quota";
import { isResourceExhausted } from "@/lib/quota/gate";
import { STATS_KEYS, statsClient, statsDay } from "./counters";

// stats-flush (nightly, 02:15 UTC; spec §5 "Compteurs"): each closed UTC day still in Valkey (up to
// a week back) is written into shopStats/{proId}.days[day], one write per active shop, and added to
// listingStats/{listingId} (views, contacts; audit C1-03), one write per listing seen that day, then
// its hash is deleted. Shop days are set, never incremented: a run cut short and repeated writes the
// same numbers. Listing totals are incremented, so each committed batch marks its listings in the
// day's hash (`x:{id}`) and a repeated run skips them. Listing views are given to their shop
// through the listing's proId (one read per listing seen that day, which also drops purged
// listings). Each shop write also deletes the days that fell out of the kept window. Deferred,
// hash kept, while Firestore writes or reads are degraded.

export const STATS_LOOKBACK_DAYS = 7;
/** Days a shop keeps: the Pro space shows 30. */
export const STATS_KEEP_DAYS = 35;
/** Days past the window deleted by each write (covers nights without a flush). */
const PRUNE_SPAN_DAYS = 30;
const TOP_LISTINGS_PER_DAY = 50;
const READ_BATCH = 100;
const DAY_MS = 24 * 3_600_000;

export interface StatsFlushResult {
  days: string[];
  shops: number;
  deferred: boolean;
}

interface Pending {
  v: number;
  lv: number;
  c: number;
  r: number;
  listings: Map<string, [number, number]>;
}

const empty = (): Pending => ({ v: 0, lv: 0, c: 0, r: 0, listings: new Map() });

function dayOffset(day: string, days: number): string {
  return statsDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/** Field of the day's hash marking a listing already added to its listingStats. */
const flushedField = (listingId: string) => `x:${listingId}`;

/** Shops and listings of one day's hash, and the listings already added to listingStats. */
function parse(hash: Record<string, string>): { shops: Map<string, Pending>; listings: Map<string, [number, number]>; flushed: Set<string> } {
  const shops = new Map<string, Pending>();
  const listings = new Map<string, [number, number]>();
  const flushed = new Set<string>();
  for (const [field, raw] of Object.entries(hash)) {
    const [scope, id, metric] = field.split(":");
    const count = Number(raw);
    if (!id || !Number.isSafeInteger(count) || count <= 0) continue;
    if (scope === "x" && metric === undefined) {
      flushed.add(id);
    } else if (scope === "s" && (metric === "v" || metric === "c" || metric === "r")) {
      const shop = shops.get(id) ?? empty();
      shop[metric] += count;
      shops.set(id, shop);
    } else if (scope === "l" && (metric === "v" || metric === "c")) {
      const entry = listings.get(id) ?? [0, 0];
      entry[metric === "v" ? 0 : 1] += count;
      listings.set(id, entry);
    }
  }
  return { shops, listings, flushed };
}

/** Listings that still exist (purged ones are left out), with their shop's proId (null: a member's). */
async function ownersOf(listingIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let start = 0; start < listingIds.length; start += READ_BATCH) {
    const batch = listingIds.slice(start, start + READ_BATCH);
    const snapshots = await db().getAll(...batch.map((id) => listingRef(id)), { fieldMask: ["proId", "status"] });
    void consume("firestore.reads", batch.length);
    snapshots.forEach((snapshot, index) => {
      const listingId = batch[index];
      const status: unknown = snapshot.get("status");
      if (!listingId || !snapshot.exists || typeof status !== "string" || status === "purged") return;
      const proId: unknown = snapshot.get("proId");
      out.set(listingId, typeof proId === "string" && proId ? proId : null);
    });
  }
  return out;
}

/** Adds the day's views and contacts to listingStats, marking each committed batch in the hash. */
async function flushListings(day: string, listings: Map<string, [number, number]>, owners: Map<string, string | null>, flushed: Set<string>, now: Date): Promise<void> {
  const pending = [...listings.entries()].filter(([listingId]) => owners.has(listingId) && !flushed.has(listingId));
  const client = statsClient();
  for (let start = 0; start < pending.length; start += 400) {
    const slice = pending.slice(start, start + 400);
    const batch = db().batch();
    for (const [listingId, [views, contacts]] of slice) {
      // increment(0) creates the other counters of a new document (listingStatsSchema is strict).
      batch.set(
        listingStatsRef(listingId),
        { views: FieldValue.increment(views), contacts: FieldValue.increment(contacts), favorites: FieldValue.increment(0), phoneReveals: FieldValue.increment(0), flushedAt: Timestamp.fromDate(now) },
        { merge: true },
      );
    }
    await batch.commit();
    void consume("firestore.writes", slice.length);
    if (client) {
      let chain = client.multi();
      for (const [listingId] of slice) chain = chain.hincrby(STATS_KEYS.day(day), flushedField(listingId), 1);
      await chain.exec();
    }
  }
}

function dayDoc(pending: Pending): ShopStatsDay {
  const top = [...pending.listings.entries()].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, TOP_LISTINGS_PER_DAY);
  return { v: pending.v, lv: pending.lv, c: pending.c, r: pending.r, ...(top.length > 0 ? { l: Object.fromEntries(top) } : {}) };
}

async function flushDay(day: string, hash: Record<string, string>, now: Date): Promise<number> {
  const { shops, listings, flushed } = parse(hash);
  const owners = await ownersOf([...listings.keys()]);
  await flushListings(day, listings, owners, flushed, now);
  for (const [listingId, [views, contacts]] of listings) {
    const proId = owners.get(listingId);
    if (!proId) continue;
    const shop = shops.get(proId) ?? empty();
    shop.lv += views;
    shop.listings.set(listingId, [views, contacts]);
    shops.set(proId, shop);
  }
  const prune: Record<string, FieldValue> = {};
  for (let offset = STATS_KEEP_DAYS; offset < STATS_KEEP_DAYS + PRUNE_SPAN_DAYS; offset += 1) prune[dayOffset(day, -offset)] = FieldValue.delete();
  const entries = [...shops.entries()];
  for (let start = 0; start < entries.length; start += 400) {
    const batch = db().batch();
    const slice = entries.slice(start, start + 400);
    for (const [proId, pending] of slice) {
      batch.set(db().collection(COLLECTIONS.shopStats).doc(proId), { days: { ...prune, [day]: dayDoc(pending) }, updatedAt: Timestamp.fromDate(now) }, { merge: true });
    }
    await batch.commit();
    void consume("firestore.writes", slice.length);
  }
  return shops.size;
}

export async function statsFlush(now = new Date()): Promise<StatsFlushResult> {
  const result: StatsFlushResult = { days: [], shops: 0, deferred: false };
  const client = statsClient();
  if (!client || !isFirebaseConfigured()) {
    logger.warn("stats-flush skipped: Valkey or Firebase not configured");
    return result;
  }
  const today = statsDay(now);
  for (let back = STATS_LOOKBACK_DAYS; back >= 1; back -= 1) {
    const day = dayOffset(today, -back);
    const key = STATS_KEYS.day(day);
    const hash = await client.hgetall(key);
    if (Object.keys(hash).length === 0) continue;
    const degraded = await firstDegraded(["firestore.writes", "firestore.reads"]);
    if (degraded) {
      result.deferred = true;
      logger.warn({ quota: degraded, day }, "stats-flush deferred: Firestore quota degraded");
      break;
    }
    try {
      result.shops += await flushDay(day, hash, now);
    } catch (error) {
      if (!isResourceExhausted(error)) throw error;
      result.deferred = true;
      logger.warn({ day }, "stats-flush deferred: Firestore answered RESOURCE_EXHAUSTED");
      break;
    }
    await client.del(key);
    result.days.push(day);
  }
  logger.info(result, "stats-flush done");
  return result;
}
