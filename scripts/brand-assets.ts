// Raster brand assets derived from the vector logo files of public/brand (audit zone 8 P1, zone 2
// L2): the default share image (og:image of pages without a photo), the home-screen icons of the web
// manifest (src/app/manifest.ts), the Apple touch icon and /favicon.ico. Run after a logo change and
// commit the output:
//
//   node scripts/brand-assets.ts
//
// sharp renders the SVG (librsvg); the ICO holds PNG images (every current browser reads them).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BRAND = `${ROOT}public/brand/`;
/** The logo's own cream (cream-200, the header colour). */
const CREAM = "#F2E9D8";

async function png(input: Buffer | string, size: number, options: { flatten?: boolean } = {}): Promise<Buffer> {
  let image = sharp(input, { density: 600 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (options.flatten) image = image.flatten({ background: CREAM });
  return image.png({ compressionLevel: 9 }).toBuffer();
}

/** An image centred on a cream canvas, at `scale` of its shorter side (maskable icon, share image). */
async function onCream(input: string, width: number, height: number, scale: number): Promise<Buffer> {
  const inner = await sharp(input, { density: 600 })
    .resize(Math.round(width * scale), Math.round(height * scale), { fit: "inside" })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: CREAM } })
    .composite([{ input: inner, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** ICO container of PNG images (ICONDIR + ICONDIRENTRY per image, then the PNG bytes). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

async function main(): Promise<void> {
  const icon = `${BRAND}aalan-icon.svg`;
  const outputs: [string, Buffer][] = [
    // Rounded tile with transparent corners: the manifest's "any" icons.
    ["public/brand/icon-192.png", await png(icon, 192)],
    ["public/brand/icon-512.png", await png(icon, 512)],
    // Full-bleed cream with the tile inside the 80 % safe zone: Android crops it to its own shape.
    ["public/brand/icon-maskable-512.png", await onCream(icon, 512, 512, 0.78)],
    // iOS fills transparent pixels with black: the tile on its own cream.
    ["public/brand/apple-touch-icon.png", await png(icon, 180, { flatten: true })],
    // 1200 x 630 (Facebook, WhatsApp, X large card), the full logo on cream.
    ["public/brand/og-default.png", await onCream(`${BRAND}aalan-logo-transparent.svg`, 1200, 630, 0.72)],
    ["public/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(icon, size) }))))],
  ];
  for (const [path, data] of outputs) {
    writeFileSync(`${ROOT}${path}`, data);
    console.log(`${path} ${data.length} bytes`);
  }
}

await main();
