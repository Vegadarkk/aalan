import type { PhotoVariant } from "@/lib/contracts/photo-variants";

/** `listings/{listingId}/{photoId}-{variant}.webp` under the public media base (design D6). */
export function photoUrl(mediaBaseUrl: string | null, listingId: string, photoId: string, variant: PhotoVariant): string | null {
  if (!mediaBaseUrl) return null;
  return `${mediaBaseUrl.replace(/\/+$/, "")}/listings/${listingId}/${photoId}-${variant}.webp`;
}

/**
 * Base of the owner route (src/app/api/owner-media): the photos of the owner's refused, removed or
 * hidden listing, kept in the private bucket (audit C-3), under the same `listings/...` paths.
 */
export const OWNER_MEDIA_BASE = "/api/owner-media";

/** The base the owner's own views read a listing's photos from: the owner route once they are private. */
export function ownerMediaBase(listing: { privatePhotos?: true }, mediaBaseUrl: string | null): string | null {
  return listing.privatePhotos ? OWNER_MEDIA_BASE : mediaBaseUrl;
}
