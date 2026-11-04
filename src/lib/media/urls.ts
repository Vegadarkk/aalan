import "server-only";
import type { PhotoVariant } from "@/lib/contracts/media";
import { mediaBaseUrl } from "@/lib/storage/keys";

// Object keys and public URLs of photos (design D6, D11). Keys are built from validated ids
// (uploadIdSchema, LISTING_ID_PATTERN) and checked again by every ObjectStore (assertObjectKey).

export const MEDIA_CONTENT_TYPE = "image/webp";
/**
 * Browser cache of a variant (audit C-3): one day, so a takedown (photo deleted, listing refused,
 * hidden or removed: its variants leave the media bucket) reaches browsers within a day. The keys
 * never change (photoId = uploadId), but `immutable` and a year would keep a taken-down photo on
 * screen. The edge keeps a copy one day at most (infra/cloudflare/cache-rules.json) and every
 * DELETE in the media bucket purges its URL (src/lib/cdn). Objects stored before this change keep
 * their year-long metadata: the edge purge covers them, browsers that already hold one do not.
 */
export const MEDIA_CACHE_CONTROL = "public, max-age=86400";

type MediaEnv = NonNullable<Parameters<typeof mediaBaseUrl>[0]>;

/** `listings/{listingId}/{photoId}-{variant}.webp` in the media bucket. */
export function mediaObjectKey(listingId: string, photoId: string, variant: PhotoVariant): string {
  return `${listingMediaPrefix(listingId)}${photoId}-${variant}.webp`;
}

/** Common prefix of a listing's variants (purge of a removed listing). */
export function listingMediaPrefix(listingId: string): string {
  return `listings/${listingId}/`;
}

/**
 * Prefix of the photos kept off the media host in the private bucket (never public): a removed,
 * refused or hidden listing's (uploads/policy.ts photosArePrivate). The worker moves them there,
 * keeping the rest of the key, and back when a refused or hidden listing returns to public view;
 * retention-purge deletes them with the listing (removal + 12 months). No lifecycle rule may cover
 * it: a legal hold extends the retention.
 */
export const RETAINED_MEDIA_PREFIX = "removed/";

/** Buckets that hold photo variants: `media` (public) or `private` (a removed, refused or hidden listing's). */
export type PhotoBucket = "media" | "private";

/** `removed/listings/{listingId}/{photoId}-{variant}.webp` in the private bucket. */
export function retainedObjectKey(listingId: string, photoId: string, variant: PhotoVariant): string {
  return `${RETAINED_MEDIA_PREFIX}${mediaObjectKey(listingId, photoId, variant)}`;
}

/** Key of a variant in either photo bucket. */
export function photoObjectKey(bucket: PhotoBucket, listingId: string, photoId: string, variant: PhotoVariant): string {
  return bucket === "media" ? mediaObjectKey(listingId, photoId, variant) : retainedObjectKey(listingId, photoId, variant);
}

/** `finalKey` of an upload document (variants add `-{variant}.webp`) for the bucket its variants are in. */
export function photoFinalKey(bucket: PhotoBucket, listingId: string, photoId: string): string {
  return `${bucket === "media" ? "" : RETAINED_MEDIA_PREFIX}${listingMediaPrefix(listingId)}${photoId}`;
}

/** The browser's original in the quarantine bucket, deleted once processed. */
export function quarantineObjectKey(uploadId: string): string {
  return `uploads/${uploadId}`;
}

/** Public URL of a variant, or null when no media host is configured (deployed without R2). */
export function photoUrl(env: MediaEnv, listingId: string, photoId: string, variant: PhotoVariant): string | null {
  const base = mediaBaseUrl(env);
  return base ? `${base}/${mediaObjectKey(listingId, photoId, variant)}` : null;
}
