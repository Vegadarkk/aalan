import type { PhotoItem } from "./store";

// Non-blocking photo notes of the wizard (zone 3 audit P3-2): a photo too small to look sharp on
// the listing page, and the same photo added twice to one listing. They warn, never refuse: the
// seller keeps the photo if they want it. Pure, unit-tested. The server's near-duplicate signal
// across a seller's listings (risk score `dup_photo`) is another matter, kept server side.

/** Below this shortest side (px) a photo looks blurred in the gallery (≈ 4:3 at 533 × 400). */
export const MIN_USEFUL_EDGE_PX = 400;
/**
 * dHash bits that may differ for "the same photo" (recompressed, resized): strict on purpose, two
 * shots of an object taken a second apart differ more and must not be flagged.
 */
export const SAME_PHOTO_MAX_DISTANCE = 2;

const HEX64 = /^[0-9a-f]{16}$/;
const FLAT_HASH = "0000000000000000";
const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Differing bits of two 16-hex-char dHashes, or null when one is not a hash. */
export function hashDistance(a: string, b: string): number | null {
  if (!HEX64.test(a) || !HEX64.test(b)) return null;
  let bits = 0;
  for (let index = 0; index < 16; index += 1) bits += NIBBLE_BITS[parseInt(a[index]!, 16) ^ parseInt(b[index]!, 16)]!;
  return bits;
}

export interface PhotoWarning {
  /** Width and height when the shortest side is under MIN_USEFUL_EDGE_PX. */
  small?: { w: number; h: number };
  /** 1-based position of the earlier tile showing the same photo. */
  sameAs?: number;
}

function shown(item: PhotoItem): item is PhotoItem & { photo: NonNullable<PhotoItem["photo"]> } {
  return item.status === "ready" && !item.removing && item.photo !== null;
}

/** The notes of each ready tile, by key; tiles without any are left out. */
export function photoWarnings(photos: readonly PhotoItem[]): Map<string, PhotoWarning> {
  const warnings = new Map<string, PhotoWarning>();
  photos.forEach((item, index) => {
    if (!shown(item)) return;
    const warning: PhotoWarning = {};
    const { w, h, hash } = item.photo;
    if (Math.min(w, h) < MIN_USEFUL_EDGE_PX) warning.small = { w, h };
    // A flat image (one colour) hashes to zero bits whatever its colour: nothing to compare.
    if (hash && hash !== FLAT_HASH) {
      const earlier = photos.findIndex((other, at) => {
        if (at >= index || !shown(other) || !other.photo.hash || other.photo.hash === FLAT_HASH) return false;
        const distance = hashDistance(hash, other.photo.hash);
        return distance !== null && distance <= SAME_PHOTO_MAX_DISTANCE;
      });
      if (earlier >= 0) warning.sameAs = earlier + 1;
    }
    if (warning.small || warning.sameAs) warnings.set(item.key, warning);
  });
  return warnings;
}
