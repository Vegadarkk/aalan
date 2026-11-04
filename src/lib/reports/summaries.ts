import "server-only";
import type { ListingStatus } from "@/lib/contracts/listings";
import type { ListingPhoto } from "@/lib/contracts/media";
import { getListings } from "@/lib/db/repositories/listings";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { parseUserRecord, type UserRecord } from "@/lib/db/repositories/profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { consume } from "@/lib/quota";
import { parseTargetKey } from "./target-key";

// What the back-office queues show of a reported target without opening it (zone 7 audit P2-8):
// a listing's title, seller, price, city and first photo; an account's name and state; a shop's
// name. A message or a review shows the listing it belongs to. One batched read per collection
// (getAll), at most a queue page of distinct targets; the target view still shows the content.

export interface ListingSummary {
  id: string;
  title: string;
  status: ListingStatus;
  sellerName: string;
  price: number | null;
  isDonation: boolean;
  citySlug: string | null;
  photo: ListingPhoto | null;
}

export interface AccountSummary {
  uid: string;
  displayName: string;
  publicId: string;
  status: UserRecord["status"];
}

export interface TargetSummary {
  /** The listing reported, or the listing a reported message or review belongs to. */
  listing: ListingSummary | null;
  account: AccountSummary | null;
  shop: { name: string; citySlug: string } | null;
}

/** Distinct targets summarised per call (a queue page holds at most 100 reports). */
export const SUMMARIES_MAX = 100;

export interface SummaryRef {
  key: string;
  /** The listing a message or review target belongs to (`reports.target.listingId`). */
  listingId?: string | null;
}

/** Listings by id, as queue cards (missing ones are left out). */
export async function listingSummaries(ids: readonly string[]): Promise<Map<string, ListingSummary>> {
  const records = await getListings([...new Set(ids)].slice(0, SUMMARIES_MAX));
  return new Map(
    records.map((listing) => [
      listing.id,
      {
        id: listing.id,
        title: listing.title,
        status: listing.status,
        sellerName: listing.sellerName,
        price: listing.price,
        isDonation: listing.isDonation,
        citySlug: listing.location?.citySlug ?? null,
        photo: listing.photos[0] ?? null,
      },
    ]),
  );
}

async function accountSummaries(uids: readonly string[]): Promise<Map<string, AccountSummary>> {
  const unique = [...new Set(uids)].slice(0, SUMMARIES_MAX);
  if (unique.length === 0) return new Map();
  const snapshots = await db().getAll(...unique.map((uid) => db().collection(COLLECTIONS.users).doc(uid)));
  void consume("firestore.reads", snapshots.length);
  const summaries = new Map<string, AccountSummary>();
  for (const snapshot of snapshots) {
    const user = parseUserRecord(snapshot.id, snapshot.data());
    if (user) summaries.set(user.uid, { uid: user.uid, displayName: user.displayName, publicId: user.publicId, status: user.status });
  }
  return summaries;
}

/** A summary per target key (malformed keys are left out); never throws, a failed read leaves the card bare. */
export async function targetSummaries(refs: readonly SummaryRef[]): Promise<Record<string, TargetSummary>> {
  const parsed = refs.slice(0, SUMMARIES_MAX).flatMap((ref) => {
    const target = parseTargetKey(ref.key);
    return target ? [{ ...ref, target }] : [];
  });
  const listingOf = (ref: (typeof parsed)[number]) => (ref.target.type === "listing" ? ref.target.id : (ref.listingId ?? null));
  const listingIds = parsed.flatMap((ref) => listingOf(ref) ?? []);
  const uids = parsed.flatMap((ref) => (ref.target.type === "user" ? [ref.target.id] : []));
  const proIds = [...new Set(parsed.flatMap((ref) => (ref.target.type === "pro" ? [ref.target.id] : [])))];
  const [listings, accounts, shops] = await Promise.all([
    listingSummaries(listingIds).catch(() => new Map<string, ListingSummary>()),
    accountSummaries(uids).catch(() => new Map<string, AccountSummary>()),
    Promise.all(proIds.map(async (proId) => [proId, await getProProfile(proId).catch(() => null)] as const)).then((rows) => new Map(rows)),
  ]);
  const summaries: Record<string, TargetSummary> = {};
  for (const ref of parsed) {
    const listingId = listingOf(ref);
    const shop = ref.target.type === "pro" ? shops.get(ref.target.id) : null;
    summaries[ref.key] = {
      listing: listingId ? (listings.get(listingId) ?? null) : null,
      account: ref.target.type === "user" ? (accounts.get(ref.target.id) ?? null) : null,
      shop: shop ? { name: shop.name, citySlug: shop.citySlug } : null,
    };
  }
  return summaries;
}
