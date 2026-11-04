import "server-only";
import type { PhotoVariant } from "@/lib/contracts/media";
import type { ObjectStore } from "@/lib/storage";
import { photoObjectKey, type PhotoBucket } from "./urls";

// A listing photo read by the app rather than the media host: the photos of a removed, refused or
// hidden listing sit in the private bucket (uploads/policy.ts photosArePrivate), where no public URL
// reaches them. The staff route (moderation review), the owner route (the seller's own views) and
// the moderation agent's image loader read both buckets (a move not done yet, or cut short).

/** Largest variant served (memory guard): a WebP of at most 1600 px, far below. */
export const MAX_STORED_PHOTO_BYTES = 8 * 1024 * 1024;

export interface StoredPhotoTarget {
  listingId: string;
  photoId: string;
  variant: PhotoVariant;
}

export interface StoredPhotoOptions {
  /** Larger variants answer null (memory guard). */
  maxBytes?: number;
  /** Bucket read first: `private` (default) where the photo is expected there, `media` otherwise (one GET saved). */
  first?: PhotoBucket;
}

/** The variant's bytes from whichever bucket holds it, or null when neither does. */
export async function readStoredPhoto(store: ObjectStore, { listingId, photoId, variant }: StoredPhotoTarget, options: StoredPhotoOptions = {}): Promise<Buffer | null> {
  const maxBytes = options.maxBytes ?? MAX_STORED_PHOTO_BYTES;
  const order: readonly PhotoBucket[] = options.first === "media" ? ["media", "private"] : ["private", "media"];
  for (const bucket of order) {
    const body = await store.get(bucket, photoObjectKey(bucket, listingId, photoId, variant), { maxBytes });
    if (body) return body.byteLength > maxBytes ? null : body;
  }
  return null;
}
