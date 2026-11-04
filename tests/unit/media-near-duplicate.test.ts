import { describe, expect, it } from "vitest";
import { dhash } from "@/lib/media/phash";
import { hammingDistance, isInformativeHash, isNearDuplicate, listingPhotoKeys, NEAR_DUPLICATE_DISTANCE, photoKeys } from "@/lib/media/near-duplicate";
import { sharp } from "@/lib/media/sharp-setup";

// Calibration of NEAR_DUPLICATE_DISTANCE (audit zone 7 P4 "Photo en double"): photo-like scenes
// (a lit background gradient, shaded objects, sensor noise, a lens blur) and what a seller or a
// copier does to them. The same picture re-encoded, resized, brightened, re-tagged, stickered or
// lightly cropped must match; unrelated scenes must not; flat pictures never match.

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Rgb = [number, number, number];
interface Scene {
  top: Rgb;
  bottom: Rgb;
  light: [number, number];
  objects: { ellipse: boolean; cx: number; cy: number; rx: number; ry: number; color: Rgb }[];
  seed: number;
}

function scene(seed: number): Scene {
  const r = random(seed * 7919 + 1);
  const rgb = (): Rgb => [r() * 255, r() * 255, r() * 255];
  const objects = Array.from({ length: 3 + Math.floor(r() * 5) }, () => ({ ellipse: r() < 0.5, cx: r(), cy: r(), rx: 0.05 + r() * 0.25, ry: 0.05 + r() * 0.25, color: rgb() }));
  return { top: rgb(), bottom: rgb(), light: [r(), r()], objects, seed };
}

async function render(s: Scene, width = 640, height = 480): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  const noise = random(s.seed + 99);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      let color = s.top.map((top, k) => top * (1 - v) + s.bottom[k]! * v);
      for (const object of s.objects) {
        const dx = (u - object.cx) / object.rx;
        const dy = (v - object.cy) / object.ry;
        const inside = object.ellipse ? dx * dx + dy * dy <= 1 : Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        if (inside) {
          const shade = 0.7 + 0.3 * (1 - Math.min(1, Math.hypot(dx - 0.3, dy + 0.3) / 1.5));
          color = object.color.map((c) => c * shade);
        }
      }
      const light = 1.1 - 0.6 * ((u - s.light[0]) ** 2 + (v - s.light[1]) ** 2);
      const grain = (noise() - 0.5) * 24;
      for (let k = 0; k < 3; k++) raw[(y * width + x) * 3 + k] = Math.max(0, Math.min(255, color[k]! * light + grain));
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).blur(1.2).jpeg({ quality: 90 }).toBuffer();
}

/** What happens to a photo between two listings. */
async function copies(photo: Buffer): Promise<Record<string, Buffer>> {
  const { width = 0, height = 0 } = await sharp(photo).metadata();
  const sticker = Buffer.alloc(160 * 24 * 3, 255);
  return {
    recompressed: await sharp(photo).jpeg({ quality: 35 }).toBuffer(),
    resized: await sharp(photo).resize(320).jpeg({ quality: 70 }).toBuffer(),
    webp: await sharp(photo).webp({ quality: 60 }).toBuffer(),
    brighter: await sharp(photo).modulate({ brightness: 1.1 }).jpeg({ quality: 80 }).toBuffer(),
    upscaledWithExif: await sharp(photo).resize(1600).withMetadata({ orientation: 1 }).jpeg({ quality: 85 }).toBuffer(),
    sticker: await sharp(photo).composite([{ input: sticker, raw: { width: 160, height: 24, channels: 3 }, left: width - 176, top: height - 40 }]).jpeg().toBuffer(),
    croppedSide: await sharp(photo).extract({ left: Math.round(width * 0.03), top: 0, width: width - Math.round(width * 0.03), height }).jpeg({ quality: 80 }).toBuffer(),
  };
}

describe("near-duplicate threshold", () => {
  it("matches a photo re-encoded, resized, brightened, re-tagged, stickered or cropped 3 % on one side", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const original = await render(scene(seed));
      const hash = await dhash(original);
      if (!isInformativeHash(hash)) continue;
      for (const [kind, copy] of Object.entries(await copies(original))) {
        const copyHash = await dhash(copy);
        expect(hammingDistance(hash, copyHash), `scene ${seed}, ${kind}`).toBeLessThanOrEqual(NEAR_DUPLICATE_DISTANCE);
        expect(isNearDuplicate(hash, copyHash), `scene ${seed}, ${kind}`).toBe(true);
      }
    }
  }, 60_000);

  it("matches unrelated scenes in under 1 pair in 1,000", async () => {
    // These scenes are a few flat blobs, poorer in detail than real photos: the worst case.
    const hashes = (await Promise.all(Array.from({ length: 80 }, async (_, i) => dhash(await render(scene(100 + i)))))).filter(isInformativeHash);
    expect(hashes.length).toBeGreaterThan(70);
    let pairs = 0;
    let matches = 0;
    let sum = 0;
    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        pairs += 1;
        sum += hammingDistance(hashes[i]!, hashes[j]!);
        if (isNearDuplicate(hashes[i], hashes[j])) matches += 1;
      }
    }
    expect(matches / pairs).toBeLessThan(0.001);
    // Unrelated hashes sit around half the bits apart, far from the threshold.
    expect(sum / pairs).toBeGreaterThan(3 * NEAR_DUPLICATE_DISTANCE);
  }, 60_000);

  it("treats flat pictures as degenerate: a plain test photo matches nothing, not even another one", async () => {
    const plain = (background: string) => sharp({ create: { width: 400, height: 300, channels: 3, background } }).jpeg().toBuffer();
    const [grey, blue] = await Promise.all([dhash(await plain("#cccccc")), dhash(await plain("#224488"))]);
    expect(grey).toBe("0000000000000000");
    expect(isInformativeHash(grey)).toBe(false);
    expect(isNearDuplicate(grey, blue)).toBe(false);
    expect(isNearDuplicate(grey, grey)).toBe(false);
    expect(isInformativeHash("00000000000000ff")).toBe(false);
    expect(isInformativeHash("ffffffffffffff00")).toBe(false);
    expect(isInformativeHash("0123456789abcdef")).toBe(true);
    expect(isNearDuplicate("0123456789abcdef", undefined)).toBe(false);
  });

  it("matches at the threshold and not one bit past it", () => {
    const base = "0123456789abcdef";
    const flip = (hash: string, bits: number) => (BigInt(`0x${hash}`) ^ ((1n << BigInt(bits)) - 1n)).toString(16).padStart(16, "0");
    expect(isNearDuplicate(base, flip(base, NEAR_DUPLICATE_DISTANCE))).toBe(true);
    expect(isNearDuplicate(base, flip(base, NEAR_DUPLICATE_DISTANCE + 1))).toBe(false);
  });
});

describe("photoKeys (cross-account lookup)", () => {
  it("cuts an informative hash into 4 band keys, never a degenerate one", () => {
    expect(photoKeys("0123456789abcdef")).toEqual(["00123", "14567", "289ab", "3cdef"]);
    expect(photoKeys("0000000000000000")).toEqual([]);
    expect(photoKeys(undefined)).toEqual([]);
    // A flat strip (one bit at most set, or unset) is common to many photos: left out.
    expect(photoKeys("00015a5affff3c3c")).toEqual(["15a5a", "33c3c"]);
  });

  it("gives two hashes 3 bits apart at least one common key (pigeonhole over 4 bands)", () => {
    const r = random(42);
    for (let run = 0; run < 500; run++) {
      const hash = Array.from({ length: 16 }, () => Math.floor(r() * 16).toString(16)).join("");
      if (photoKeys(hash).length < 4) continue;
      let flipped = BigInt(`0x${hash}`);
      for (let bit = 0; bit < 3; bit++) flipped ^= 1n << BigInt(Math.floor(r() * 64));
      const near = flipped.toString(16).padStart(16, "0");
      if (!isInformativeHash(near) || photoKeys(near).length < 4) continue;
      expect(photoKeys(hash).some((key) => photoKeys(near).includes(key)), `${hash} / ${near}`).toBe(true);
    }
  });

  it("lists a listing's keys once, in photo order, photos without a hash skipped", () => {
    expect(listingPhotoKeys([{ hash: "0123456789abcdef" }, {}, { hash: "0123456789abcdef" }, { hash: "0123fedcba987654" }])).toEqual(["00123", "14567", "289ab", "3cdef", "1fedc", "2ba98", "37654"]);
  });
});
