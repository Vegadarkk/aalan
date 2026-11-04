import "server-only";
import { srcSetOf, type PhotoLike, type PhotoSources } from "@/components/listing/photo";
import { listingIdSchema, type ListingStatus } from "@/lib/contracts/listings";
import { PHOTO_VARIANTS, uploadIdSchema, type PhotoVariant } from "@/lib/contracts/media";
import { MAX_STORED_PHOTO_BYTES, readStoredPhoto, type StoredPhotoTarget } from "@/lib/media/stored-photo";
import type { ObjectStore } from "@/lib/storage";
import { PRIVATE_PHOTO_STATUSES } from "@/lib/uploads/policy";

// Photos of the back office that are not public: a removed, refused or hidden listing's variants
// move to the private bucket (uploads/policy.ts photosArePrivate), where no public URL reaches
// them. The moderation review shows them through the staff-only route
// /photos/{listingId}/{photoId}/{variant} (admin host, moderators and admins; no dot in the path,
// so proxy.ts rewrites it to src/app/admin/photos), which reads the private bucket first, then the
// media bucket (a move not done yet, or cut short).

/** Largest variant served (memory guard): a WebP of at most 1600 px, far below. */
export const MAX_STAFF_PHOTO_BYTES = MAX_STORED_PHOTO_BYTES;

/**
 * Listings whose photos the review reads through the staff route rather than the public media
 * host: by status (refused, removed). A hidden listing keeps a public status: the views that may
 * show one (report queues) use the staff route whatever the status.
 */
export function usesStaffPhotos(status: ListingStatus): boolean {
  return PRIVATE_PHOTO_STATUSES.includes(status);
}

/** Same-origin path of a variant on the admin host. */
export function staffPhotoPath(listingId: string, photoId: string, variant: PhotoVariant): string {
  return `/photos/${listingId}/${photoId}/${variant}`;
}

/** photoSources() through the staff route: the photo's variants as `src` + `srcSet`. */
export function staffPhotoSources(listingId: string, photo: PhotoLike, prefer: PhotoVariant = "s"): PhotoSources {
  const small = staffPhotoPath(listingId, photo.id, "s");
  const large = staffPhotoPath(listingId, photo.id, "l");
  const srcSet = srcSetOf(photo, (variant) => staffPhotoPath(listingId, photo.id, variant));
  return { src: prefer === "s" ? small : large, srcSet, width: photo.w, height: photo.h, large };
}

export type StaffPhotoTarget = StoredPhotoTarget;

/** The route's segments, validated (ids by their schemas, a known variant), or null. */
export function parseStaffPhotoParams(params: Record<string, string | string[] | undefined>): StaffPhotoTarget | null {
  const listingId = listingIdSchema.safeParse(params["listingId"]);
  const photoId = uploadIdSchema.safeParse(params["photoId"]);
  const variant = PHOTO_VARIANTS.find((name) => name === params["variant"]);
  if (!listingId.success || !photoId.success || !variant) return null;
  return { listingId: listingId.data, photoId: photoId.data, variant };
}

/** The variant's bytes from whichever bucket holds it (private first), or null when neither does. */
export function readStaffPhoto(store: ObjectStore, target: StaffPhotoTarget): Promise<Buffer | null> {
  return readStoredPhoto(store, target);
}
