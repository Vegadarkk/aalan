// Near-duplicate photos from their 64-bit dHash (src/lib/media/phash.ts): pure, no sharp, so the
// listings repository and the screening can use it. Audit zone 7 P4 "Photo en double": the signal
// compared hashes by equality, so a recompressed, resized or slightly cropped copy was missed.
//
// Threshold, calibrated in tests/unit/media-near-duplicate.test.ts on photo-like scenes (lit
// background, shaded objects, sensor noise): a JPEG recompression, a resize, a WebP re-encode, a
// brightness change, EXIF added, a sticker in a corner or a 3 % crop of one side move 0 to 9 bits
// (98 % of 196 such copies within 8); unrelated scenes, poorer in detail than real photos, are
// within 8 bits in 0.05 % of 6,555 pairs (mean ~30). A crop of 5 % on every side moves 3 to 14
// bits and is caught about 3 times in 4: past that, it is a new framing. A lower threshold (6)
// misses 1 copy in 20; a higher one (10) makes chance matches about 4 times as frequent.
//
// Degenerate hashes: a flat picture (a plain colour, a blank test photo) hashes to 0, a picture
// dominated by a left-right light gradient to nearly 0 or nearly all ones. Within the threshold of
// those, two photos share nothing but their lighting, so such hashes never match (the audit's plain
// test photos raised "Photo en double" through this).

const HEX64 = /^[0-9a-f]{16}$/;

/** Hamming distance at or under which two photos are the same picture (64-bit dHash). */
export const NEAR_DUPLICATE_DISTANCE = 8;

/** Bands of the cross-account lookup: 4 x 16 bits, one Firestore key each (`photoKeys`). */
export const PHOTO_KEY_BANDS = 4;
const BAND_HEX = 16 / PHOTO_KEY_BANDS;
/** A stored photo key: the band index, then the band's 4 hex chars ("2a0f3"). */
export const PHOTO_KEY_PATTERN = /^[0-3][0-9a-f]{4}$/;

export function isImageHash(value: string): boolean {
  return HEX64.test(value);
}

function popcount(value: bigint): number {
  let x = value;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count += 1;
  }
  return count;
}

/** Number of differing bits between two 16-hex-char hashes (0..64). */
export function hammingDistance(a: string, b: string): number {
  if (!HEX64.test(a) || !HEX64.test(b)) throw new RangeError("hammingDistance: expected two 16-char hex hashes");
  return popcount(BigInt(`0x${a}`) ^ BigInt(`0x${b}`));
}

/** False for a hash within the threshold of a flat picture's (0) or of all ones: it carries no picture. */
export function isInformativeHash(hash: string): boolean {
  if (!HEX64.test(hash)) return false;
  const bits = popcount(BigInt(`0x${hash}`));
  return bits > NEAR_DUPLICATE_DISTANCE && bits < 64 - NEAR_DUPLICATE_DISTANCE;
}

/** Two photo hashes show the same picture: both informative and within NEAR_DUPLICATE_DISTANCE bits. */
export function isNearDuplicate(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || !isInformativeHash(a) || !isInformativeHash(b)) return false;
  return hammingDistance(a, b) <= NEAR_DUPLICATE_DISTANCE;
}

/**
 * Lookup keys of a hash (LSH by bands): two hashes at distance d <= 3 share at least one band
 * (pigeonhole), at d = 4 nine times in ten, at d = 8 one time in three; the candidates are then
 * checked with isNearDuplicate. A band that is a flat strip (at most one bit set or unset) is
 * left out: such strips are common to many photos and would crowd the lookup. None for a
 * degenerate hash.
 */
export function photoKeys(hash: string | undefined): string[] {
  if (!hash || !isInformativeHash(hash)) return [];
  const keys: string[] = [];
  for (let band = 0; band < PHOTO_KEY_BANDS; band++) {
    const hex = hash.slice(band * BAND_HEX, (band + 1) * BAND_HEX);
    const bits = popcount(BigInt(`0x${hex}`));
    if (bits <= 1 || bits >= BAND_HEX * 4 - 1) continue;
    keys.push(`${band}${hex}`);
  }
  return keys;
}

/** Distinct lookup keys of a listing's photos, in photo order (`listings.photoKeys`). */
export function listingPhotoKeys(photos: readonly { hash?: string }[]): string[] {
  return [...new Set(photos.flatMap((photo) => photoKeys(photo.hash)))];
}
