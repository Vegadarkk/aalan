import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { KYBC_IMAGE_MAX_EDGE, KYBC_STORED_MAX_BYTES, sanitizeKybcPiece } from "@/lib/pro/kybc-uploads";

// KYBC image pieces are re-encoded before they are stored: the stored object is bounded in pixels
// and in bytes whatever the upload looked like.

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An RGB PNG whose rows all differ but whose filtered rows are identical (Up filter): tiny on input. */
function craftedPng(size: number): Buffer {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  for (let x = 0; x < stride; x += 1) raw[1 + x] = next();
  const delta = Buffer.alloc(stride);
  for (let x = 0; x < stride; x += 1) delta[x] = next() | 1;
  for (let y = 1; y < size; y += 1) {
    const at = y * (stride + 1);
    raw[at] = 2;
    delta.copy(raw, at + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

describe("sanitizeKybcPiece", () => {
  it("stores a crafted PNG scaled down and bounded in bytes, or refuses it as too large", async () => {
    const input = craftedPng(3800);
    expect(input.byteLength).toBeLessThan(2 * 1024 * 1024);
    const out = await sanitizeKybcPiece(input, "image/png");
    if ("reason" in out) {
      expect(out.reason).toBe("too_large");
    } else {
      expect(out.bytes.byteLength).toBeLessThanOrEqual(KYBC_STORED_MAX_BYTES);
      const meta = await sharp(out.bytes).metadata();
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(KYBC_IMAGE_MAX_EDGE);
    }
  }, 30_000);

  it("keeps an ordinary scan at its size", async () => {
    const scan = await sharp({ create: { width: 1200, height: 1700, channels: 3, background: "#f4efe6" } }).png().toBuffer();
    const out = await sanitizeKybcPiece(scan, "image/png");
    expect("bytes" in out).toBe(true);
    if ("bytes" in out) expect(await sharp(out.bytes).metadata()).toMatchObject({ width: 1200, height: 1700, format: "png" });
  });
});
