import "server-only";
import { openImage } from "./sharp-setup";

export { hammingDistance, isImageHash } from "./near-duplicate";

// 64-bit difference hash (dHash) for near-duplicate photos (design §1 `photos[].hash`, risk score
// `dup_photo`): greyscale 9x8, one bit per horizontally adjacent pair. Stable under recompression
// and resizing, not under rotation or mirroring. Stored as 16 hex chars; compared with
// isNearDuplicate (./near-duplicate.ts: Hamming distance, threshold and its calibration).

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/** The hash of a 9x8 greyscale raster (row-major, one byte per pixel); exported for tests. */
export function dhashFromGrey(pixels: Uint8Array, width = DHASH_WIDTH, height = DHASH_HEIGHT): string {
  if (pixels.length < width * height) throw new RangeError("dhash: raster too small");
  let bits = 0n;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = pixels[y * width + x] ?? 0;
      const right = pixels[y * width + x + 1] ?? 0;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** dHash of an image buffer (JPEG/PNG/WebP), EXIF orientation applied first. */
export async function dhash(image: Buffer): Promise<string> {
  const { data, info } = await openImage(image)
    .rotate()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .removeAlpha()
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error(`dhash: expected 1 channel, got ${info.channels}`);
  return dhashFromGrey(data);
}
