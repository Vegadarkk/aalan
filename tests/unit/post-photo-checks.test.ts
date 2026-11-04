import { describe, expect, it } from "vitest";
import { MIN_USEFUL_EDGE_PX, hashDistance, photoWarnings } from "@/lib/listings/client/photo-checks";
import type { PhotoItem } from "@/lib/listings/client/store";

// Non-blocking photo notes of the wizard (zone 3 audit P3-2): a tiny photo, the same photo twice.

function tile(key: string, photo: { w?: number; h?: number; hash?: string } = {}, changes: Partial<PhotoItem> = {}): PhotoItem {
  return {
    key,
    uploadId: key,
    status: "ready",
    progress: 1,
    previewUrl: null,
    photo: { id: `${key}xxxxxxxx`, w: photo.w ?? 1600, h: photo.h ?? 1200, blurhash: "LEHV6nWB2yk8", ...(photo.hash ? { hash: photo.hash } : {}) },
    ...changes,
  };
}

describe("hashDistance", () => {
  it("counts the differing bits of two dHashes", () => {
    expect(hashDistance("0123456789abcdef", "0123456789abcdef")).toBe(0);
    expect(hashDistance("0000000000000000", "0000000000000003")).toBe(2);
    expect(hashDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hashDistance("f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f")).toBe(64);
  });

  it("answers null for anything but two 64-bit hex hashes", () => {
    expect(hashDistance("abc", "0123456789abcdef")).toBeNull();
    expect(hashDistance("0123456789ABCDEF", "0123456789abcdef")).toBeNull();
  });
});

describe("photoWarnings", () => {
  it("leaves photos of a useful size alone", () => {
    expect(photoWarnings([tile("a"), tile("b", { w: MIN_USEFUL_EDGE_PX, h: 2000 })]).size).toBe(0);
  });

  it("flags a photo whose shortest side is under the useful minimum", () => {
    const warnings = photoWarnings([tile("a"), tile("b", { w: 50, h: 50 }), tile("c", { w: 1600, h: MIN_USEFUL_EDGE_PX - 1 })]);
    expect(warnings.get("b")).toEqual({ small: { w: 50, h: 50 } });
    expect(warnings.get("c")).toEqual({ small: { w: 1600, h: MIN_USEFUL_EDGE_PX - 1 } });
    expect(warnings.has("a")).toBe(false);
  });

  it("flags the later copy of the same photo with the position of the first one", () => {
    const warnings = photoWarnings([tile("a", { hash: "0123456789abcdef" }), tile("b", { hash: "fedcba9876543210" }), tile("c", { hash: "0123456789abcdee" })]);
    expect(warnings.get("c")).toEqual({ sameAs: 1 });
    expect(warnings.has("a")).toBe(false);
    expect(warnings.has("b")).toBe(false);
  });

  it("does not take two shots of the same object for the same photo", () => {
    // 3 bits apart: past the strict "same photo" threshold.
    expect(photoWarnings([tile("a", { hash: "0123456789abcdef" }), tile("b", { hash: "0123456789abcde8" })]).size).toBe(0);
  });

  it("ignores flat images, tiles still uploading or being removed, and photos without a hash", () => {
    const flat = "0000000000000000";
    expect(photoWarnings([tile("a", { hash: flat }), tile("b", { hash: flat })]).size).toBe(0);
    expect(photoWarnings([tile("a", { hash: "0123456789abcdef" }), tile("b", { hash: "0123456789abcdef" }, { status: "processing" })]).size).toBe(0);
    expect(photoWarnings([tile("a", { hash: "0123456789abcdef" }, { removing: true }), tile("b", { hash: "0123456789abcdef" })]).size).toBe(0);
    expect(photoWarnings([tile("a"), tile("b")]).size).toBe(0);
  });

  it("keeps both notes on one tile", () => {
    const warnings = photoWarnings([tile("a", { w: 60, h: 60, hash: "0123456789abcdef" }), tile("b", { w: 60, h: 60, hash: "0123456789abcdef" })]);
    expect(warnings.get("a")).toEqual({ small: { w: 60, h: 60 } });
    expect(warnings.get("b")).toEqual({ small: { w: 60, h: 60 }, sameAs: 1 });
  });
});
