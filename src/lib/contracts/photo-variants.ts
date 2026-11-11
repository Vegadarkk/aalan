// WebP variants of a listing photo (design D6), without zod: the gallery and the cards build their
// srcset from these in the browser. media.ts re-exports them.

/**
 * Published under `listings/{listingId}/{photoId}-{variant}.webp`: `l` (gallery on large screens,
 * lightbox, OG image), `m` (the gallery on phones: ~720 to 1000 device pixels wide) and `s` (cards,
 * thumbnails).
 */
export const PHOTO_VARIANTS = ["l", "m", "s"] as const;
export type PhotoVariant = (typeof PHOTO_VARIANTS)[number];
/**
 * Qualities tuned on 2026-11-11 with sharp's sharp-YUV subsampling and effort 6 (process.ts): -19 %
 * bytes per photo (220 -> 178 KB for l+m+s on 12 phone-size photos), luma SSIM of `l` 0.969 -> 0.961,
 * no visible difference at 100 %. R2's free 10 GB is shared with another project of the account.
 */
export const PHOTO_VARIANT_SPECS: Record<PhotoVariant, { maxEdge: number; quality: number }> = {
  l: { maxEdge: 1600, quality: 76 },
  m: { maxEdge: 960, quality: 75 },
  s: { maxEdge: 480, quality: 72 },
};

/** Variants of the photos processed before `m` existed: what a photo without a `variants` list has. */
export const LEGACY_PHOTO_VARIANTS: readonly PhotoVariant[] = ["l", "s"];
