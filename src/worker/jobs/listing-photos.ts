import { getListing } from "@/lib/db/repositories/listings";
import { listPrivateUploadsByTarget } from "@/lib/db/repositories/uploads";
import { isFirestoreConfigured } from "@/lib/firebase/admin";
import { logger } from "@/lib/logging/logger";
import { isDegraded } from "@/lib/quota";
import { isStorageNotConfigured, objectStore, type ObjectStore } from "@/lib/storage";
import { photosArePrivate } from "@/lib/uploads/policy";
import { releaseUpload, retainListingPhotos } from "./purge-quarantine";

// Job "sync-listing-photos" {listingId} of the "media" queue (audit C-3, owner decision 2026-11-04):
// puts one listing's photos in the bucket its state calls for (uploads/policy.ts photosArePrivate).
//   - removed, refused or hidden: every public variant moves to the private bucket (retainUpload:
//     the public copy goes only once the private one is checked), and its DELETE purges the URL
//     from the edge cache (storage/purging.ts, src/lib/cdn);
//   - otherwise (back in public view: resubmitted or re-approved, appeal granted, hold lifted, or
//     simply a live listing): the `ready` photos found in the private bucket move back to the media
//     one. A photo deleted by its owner under a legal hold (`rejected`) stays private.
// Queued by the search worker after each index pass (every status or visibility change that writes
// a searchOutbox entry, whichever module made it) and by the media pipeline when it attaches a photo
// to a listing whose photos are private. Idempotent and safe to repeat: it reads the listing as it
// is when it runs. purge-quarantine (hourly) is the backstop of the hiding direction. A live
// listing costs one listing read and one uploads query (one read when nothing is private).
// Degraded mode (Firestore write quota at 100 %): nothing moves; the hourly scan, guarded the same
// way, catches up once the quota resets, and the next change of a listing back in view restores it.

export interface ListingPhotosResult {
  action: "none" | "retain" | "release";
  /** Uploads moved to the private bucket. */
  retained: number;
  /** Uploads moved back to the media bucket. */
  released: number;
  failed: number;
}

export async function syncListingPhotos(listingId: string, now = new Date(), deps: { store?: ObjectStore } = {}): Promise<ListingPhotosResult> {
  const result: ListingPhotosResult = { action: "none", retained: 0, released: 0, failed: 0 };
  if (!isFirestoreConfigured()) return result;
  let store: ObjectStore;
  try {
    store = deps.store ?? objectStore();
  } catch (error) {
    if (!isStorageNotConfigured(error)) throw error;
    return result;
  }
  if (await isDegraded("firestore.writes")) {
    logger.warn({ listingId }, "listing photos not synced: Firestore write quota degraded");
    return result;
  }
  const listing = await getListing(listingId);
  // Gone or purged: retention-purge and the document purge delete its photos from both buckets.
  if (!listing || listing.status === "purged") return result;
  if (photosArePrivate(listing)) {
    result.action = "retain";
    // A failed upload is handed to the document purge (purgeAt = now), which retries it hourly.
    await retainListingPhotos(store, listing, now, result);
  } else {
    result.action = "release";
    for (const upload of await listPrivateUploadsByTarget(listing.id)) {
      if (upload.purpose !== "listing" || upload.status !== "ready") continue;
      try {
        if (await releaseUpload(store, upload, now)) result.released += 1;
      } catch (error) {
        // Thrown at the end: BullMQ retries the job, which finds what already moved in place.
        result.failed += 1;
        logger.warn({ uploadId: upload.id, err: (error as Error).message }, "listing photo not moved back to the media bucket");
      }
    }
    if (result.failed > 0) throw new Error(`${result.failed} photo(s) of listing ${listing.id} not moved back to the media bucket`);
  }
  if (result.retained > 0 || result.released > 0) logger.info({ listingId, ...result }, "listing photos synced");
  return result;
}
