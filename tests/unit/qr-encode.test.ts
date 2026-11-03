import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeQr, qrSvg, QR_MAX_VERSION } from "@/lib/qr/encode";

// The shop QR codes (UX audit lot 3). Reference hashes come from python-qrcode 8 (byte mode,
// level M, forced version and mask); every auto-encoded case was also decoded with zxing-cpp.
const rows = (text: string, mask?: number) => {
  const matrix = encodeQr(text, mask === undefined ? {} : { mask });
  return { matrix, hash: createHash("sha256").update(matrix.modules.map((row) => row.map((dark) => (dark ? "1" : "0")).join("")).join("\n")).digest("hex") };
};

describe("encodeQr", () => {
  it.each([
    ["https://aalan.ma/fr/boutique/garage-atlas", 0, 3, "2898222e3fb64386daafef89e34f44301449eb2681242814263412021a88a9a0"],
    ["https://staging.aalan.ma/ar/boutique/agence-immobiliere-du-rif-tanger-centre", 5, 5, "b4814b5f272c54ef00d031e2fcf75c394753571d33686eb083d09cd2c68b50f4"],
    [`https://aalan.ma/fr/boutique/${"x".repeat(120)}`, 7, 8, "441f8098c2799a848a7a7478ede3fc7175a2c655541ddcbcf229a55133f7687d"],
    [`https://aalan.ma/fr/boutique/${"élan-ü".repeat(20)}`, 1, 10, "d26cb2b07f11047229360d2575ce584ae6e4fb6c843148605be5dc738868c979"],
  ])("matches the reference matrix of %s (mask %i)", (text, mask, version, hash) => {
    const result = rows(text, mask);
    expect(result.matrix.version).toBe(version);
    expect(result.matrix.size).toBe(version * 4 + 17);
    expect(result.hash).toBe(hash);
  });

  it("picks the smallest version and a mask by penalty", () => {
    const { matrix } = rows("https://aalan.ma/fr/boutique/garage-atlas");
    expect(matrix.version).toBe(3);
    expect(matrix.mask).toBeGreaterThanOrEqual(0);
    expect(matrix.mask).toBeLessThan(8);
    // Finder pattern, top left: dark ring, light ring, dark 3x3 core.
    expect(matrix.modules[0]!.slice(0, 7).every(Boolean)).toBe(true);
    expect(matrix.modules[1]!.slice(1, 6).some(Boolean)).toBe(false);
    expect(matrix.modules[3]![3]).toBe(true);
  });

  it("refuses a text past version 10", () => {
    expect(QR_MAX_VERSION).toBe(10);
    expect(() => encodeQr("x".repeat(214))).toThrow(RangeError);
    expect(encodeQr("x".repeat(213)).version).toBe(10);
  });
});

describe("qrSvg", () => {
  it("draws one path with a quiet zone and only accepts hex colours", () => {
    const matrix = encodeQr("https://aalan.ma");
    const svg = qrSvg(matrix, { color: "#1f4d3a", background: "red\" onload=\"x" });
    const side = matrix.size + 8;
    expect(svg).toContain(`viewBox="0 0 ${side} ${side}"`);
    expect(svg).toContain('fill="#1f4d3a"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain("onload");
    expect(svg.match(/<path /g)).toHaveLength(1);
  });
});
