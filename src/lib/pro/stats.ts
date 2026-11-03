import "server-only";
import type { AuthContext } from "@/lib/auth/guards";
import type { ShopStatsListing, ShopStatsResponse, ShopStatsTotals } from "@/lib/contracts/pro";
import { listingRef } from "@/lib/db/repositories/listings";
import { timestampsToDates } from "@/lib/db/repositories/timestamps";
import { COLLECTIONS, shopStatsSchema, type ShopStatsDay } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { HttpError } from "@/lib/http/errors";
import { consume } from "@/lib/quota";
import { statsDay } from "@/lib/stats/counters";

// The Pro space's counters (UX audit of the Pro shops, lot 1): the last 7 and 30 closed UTC days
// of shopStats/{proId} (written each night by stats-flush) and the 30 days' most viewed listings.
// One read, plus one per listing shown (at most 5). Every member of the shop may read them.

const DAY_MS = 24 * 3_600_000;
const TOP_LISTINGS = 5;

const zero = (): ShopStatsTotals => ({ storefrontViews: 0, listingViews: 0, contacts: 0, reveals: 0 });

function add(totals: ShopStatsTotals, day: ShopStatsDay): void {
  totals.storefrontViews += day.v;
  totals.listingViews += day.lv;
  totals.contacts += day.c;
  totals.reveals += day.r;
}

export async function readShopStats(auth: AuthContext, now = new Date()): Promise<ShopStatsResponse> {
  const { proId } = auth.user.claims;
  if (!proId) throw new HttpError(409, "pro_not_verified");
  const snapshot = await db().collection(COLLECTIONS.shopStats).doc(proId).get();
  void consume("firestore.reads", 1);
  const parsed = snapshot.exists ? shopStatsSchema.safeParse(timestampsToDates(snapshot.data() ?? {})) : null;
  const days = parsed?.success ? parsed.data.days : {};

  const last7 = zero();
  const last30 = zero();
  const listings = new Map<string, [number, number]>();
  for (let back = 1; back <= 30; back += 1) {
    const day = days[statsDay(new Date(now.getTime() - back * DAY_MS))];
    if (!day) continue;
    add(last30, day);
    if (back <= 7) add(last7, day);
    for (const [id, [views, contacts]] of Object.entries(day.l ?? {})) {
      const entry = listings.get(id) ?? [0, 0];
      entry[0] += views;
      entry[1] += contacts;
      listings.set(id, entry);
    }
  }

  const top = [...listings.entries()].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, TOP_LISTINGS);
  let topListings: ShopStatsListing[] = [];
  if (top.length > 0) {
    const snapshots = await db().getAll(...top.map(([id]) => listingRef(id)), { fieldMask: ["title", "slugId", "proId", "status"] });
    void consume("firestore.reads", top.length);
    topListings = top.map(([id, [views, contacts]], index) => {
      const listing = snapshots[index];
      // Only this shop's listings, and only what a visitor could open.
      const readable = listing?.exists && listing.get("proId") === proId && listing.get("status") === "published";
      const title: unknown = readable ? listing.get("title") : null;
      const slugId: unknown = readable ? listing.get("slugId") : null;
      return { id, title: typeof title === "string" ? title : null, slugId: typeof slugId === "string" ? slugId : null, views, contacts };
    });
  }
  return { last7, last30, topListings, through: statsDay(new Date(now.getTime() - DAY_MS)) };
}
