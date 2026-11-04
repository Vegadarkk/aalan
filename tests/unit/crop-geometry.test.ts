import { describe, expect, it } from "vitest";
import { FULL_CROP, INITIAL_CROP, MIN_CROP, addTurns, clampRect, cropPixels, drawTurned, isFullRect, moveRect, resizeRect, rotateRect, turnedSize } from "@/components/post/crop-geometry";

// Crop rectangle of the photo crop dialog (faces found on a photo): fractions of the image, kept
// inside it and at least MIN_CROP on each side, mapped to whole pixels for the canvas.

const close = (actual: Record<string, number>, expected: Record<string, number>) => {
  for (const [key, value] of Object.entries(expected)) expect(actual[key], key).toBeCloseTo(value, 6);
};

describe("crop geometry", () => {
  it("moves the frame and stops it at the image edges", () => {
    close({ ...moveRect(INITIAL_CROP, 0.05, -0.05) }, { x: 0.15, y: 0.05, w: 0.8, h: 0.8 });
    close({ ...moveRect(INITIAL_CROP, 0.5, 0.5) }, { x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
    close({ ...moveRect(INITIAL_CROP, -1, -1) }, { x: 0, y: 0 });
  });

  it("resizes from a corner, the opposite corner fixed, never below the minimum", () => {
    close({ ...resizeRect(INITIAL_CROP, "se", -0.3, -0.2) }, { x: 0.1, y: 0.1, w: 0.5, h: 0.6 });
    close({ ...resizeRect(INITIAL_CROP, "nw", 0.2, 0.1) }, { x: 0.3, y: 0.2, w: 0.6, h: 0.7 });
    const tiny = resizeRect(INITIAL_CROP, "ne", -5, 5);
    close({ ...tiny }, { x: 0.1, w: MIN_CROP, h: MIN_CROP, y: 0.9 - MIN_CROP });
    close({ ...resizeRect(INITIAL_CROP, "sw", -5, 5) }, { x: 0, y: 0.1, w: 0.9, h: 0.9 });
  });

  it("clamps an out-of-range rectangle into the image", () => {
    close({ ...clampRect({ x: -0.2, y: 0.95, w: 2, h: 0.05 }) }, { x: 0, y: 1 - MIN_CROP, w: 1, h: MIN_CROP });
  });

  it("maps the rectangle to whole pixels inside the image", () => {
    expect(cropPixels(INITIAL_CROP, 1600, 1200)).toEqual({ sx: 160, sy: 120, sw: 1280, sh: 960 });
    expect(cropPixels({ x: 0.999, y: 0, w: 0.2, h: 1 }, 1000, 500)).toEqual({ sx: 999, sy: 0, sw: 1, sh: 500 });
  });
});

describe("quarter turns (audit §7)", () => {
  it("counts turns both ways around", () => {
    expect(addTurns(0, 1)).toBe(1);
    expect(addTurns(3, 1)).toBe(0);
    expect(addTurns(0, -1)).toBe(3);
    expect(turnedSize(1600, 1200, 1)).toEqual({ width: 1200, height: 1600 });
    expect(turnedSize(1600, 1200, 2)).toEqual({ width: 1600, height: 1200 });
  });

  it("keeps the same area of the photo when the image turns", () => {
    const top = { x: 0.1, y: 0, w: 0.5, h: 0.3 };
    // Clockwise: the top band becomes the right band.
    close({ ...rotateRect(top, 1) }, { x: 0.7, y: 0.1, w: 0.3, h: 0.5 });
    // Counter-clockwise: the left band.
    close({ ...rotateRect(top, -1) }, { x: 0, y: 0.4, w: 0.3, h: 0.5 });
    // A turn and back is the identity; four turns too.
    close({ ...rotateRect(rotateRect(top, 1), -1) }, top);
    close({ ...rotateRect(rotateRect(rotateRect(rotateRect(top, 1), 1), 1), 1) }, top);
    expect(isFullRect(rotateRect(FULL_CROP, 1))).toBe(true);
  });

  it("tells the whole frame from a cut one", () => {
    expect(isFullRect(FULL_CROP)).toBe(true);
    expect(isFullRect(INITIAL_CROP)).toBe(false);
    expect(isFullRect({ x: 0.0001, y: 0, w: 0.9999, h: 1 })).toBe(true);
  });

  it("draws the image centred and turned on the turned canvas", () => {
    const calls: string[] = [];
    const context = {
      translate: (x: number, y: number) => calls.push(`translate ${x} ${y}`),
      rotate: (angle: number) => calls.push(`rotate ${Math.round((angle * 180) / Math.PI)}`),
      drawImage: (_image: unknown, x: number, y: number, w: number, h: number) => calls.push(`draw ${x} ${y} ${w} ${h}`),
    };
    drawTurned(context as never, {} as CanvasImageSource, 1600, 1200, 1);
    expect(calls).toEqual(["translate 600 800", "rotate 90", "draw -800 -600 1600 1200"]);
  });
});
