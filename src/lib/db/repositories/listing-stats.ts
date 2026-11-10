import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { consume } from "@/lib/quota";
import { COLLECTIONS, listingStatsSchema, type ListingStatsDoc } from "../schemas";
import { timestampsToDates } from "./timestamps";

// listingStats/{listingId} (§5): counters kept apart from the listing (no version bump, no
// reindex). Phone reveals and payment clicks are counted synchronously; views and contacts are
// added by the nightly stats-flush (src/lib/stats/flush.ts, audit C1-03); favorites are not
// flushed yet. Deleted with the listing's purge (retention.ts purgeListing).

export const listingStatsRef = (listingId: string) => db().collection(COLLECTIONS.listingStats).doc(listingId);

export async function getListingStats(listingId: string): Promise<ListingStatsDoc | null> {
  const snapshot = await listingStatsRef(listingId).get();
  void consume("firestore.reads", 1);
  const data = snapshot.data();
  if (!data) return null;
  const parsed = listingStatsSchema.safeParse(timestampsToDates(data));
  return parsed.success ? parsed.data : null;
}

/** Views and contacts of each listing that has counters (« Mes annonces »); one read per id. */
export async function getListingCounts(listingIds: readonly string[]): Promise<Map<string, { views: number; contacts: number }>> {
  const out = new Map<string, { views: number; contacts: number }>();
  if (listingIds.length === 0) return out;
  const snapshots = await db().getAll(...listingIds.map((id) => listingStatsRef(id)), { fieldMask: ["views", "contacts"] });
  void consume("firestore.reads", listingIds.length);
  snapshots.forEach((snapshot, index) => {
    const id = listingIds[index];
    const views: unknown = snapshot.get("views");
    const contacts: unknown = snapshot.get("contacts");
    if (!id || !snapshot.exists) return;
    out.set(id, { views: Number.isSafeInteger(views) ? (views as number) : 0, contacts: Number.isSafeInteger(contacts) ? (contacts as number) : 0 });
  });
  return out;
}

/** +1 on one counter; creates the document on the first count (transaction keeps the schema whole). */
async function incrementCounter(listingId: string, field: "phoneReveals" | "paymentClicks", now: Date): Promise<void> {
  const ref = listingStatsRef(listingId);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    void consume("firestore.reads", 1);
    if (snapshot.exists) {
      tx.update(ref, { [field]: FieldValue.increment(1) });
    } else {
      const doc = listingStatsSchema.parse({ views: 0, favorites: 0, contacts: 0, phoneReveals: 0, flushedAt: now, [field]: 1 });
      tx.create(ref, { ...doc, flushedAt: Timestamp.fromDate(now) });
    }
    void consume("firestore.writes", 1);
  });
}

/** +1 phone reveal. */
export function incrementPhoneReveals(listingId: string, now = new Date()): Promise<void> {
  return incrementCounter(listingId, "phoneReveals", now);
}

/** +1 « Payer chez le vendeur » opened from the listing. */
export function incrementPaymentClicks(listingId: string, now = new Date()): Promise<void> {
  return incrementCounter(listingId, "paymentClicks", now);
}
