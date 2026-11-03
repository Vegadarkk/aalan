// Glints on the gate's gilded tiles while the welcome screen waits (owner, 3 Nov 2026: "un effet de
// brillance aléatoire" on the gold mosaic): now and then, at a random point of the khatam lattice,
// light catches the gilding: the tiles around it brighten and a small four-pointed flare blooms and
// turns. Played by src/components/welcome/glint-layer.ts with the Web Animations API (transform and
// opacity only); never under reduced motion, never once the door opens.

import { DOOR_VIEWBOX } from "@/lib/welcome/motion";

/** The gate's frame inside its inner gold line (ALFIZ in door-scene.tsx, inset by 4). */
export const TILES = { x: 114, y: 48, width: 284, height: 366 } as const;
/**
 * The arch cut out of the tiles (ARCH in door-scene.tsx): two arcs of radius 136.32 meeting at the
 * apex (256, 62.8), each springing at y 267.23 from x 160 and 352, then straight jambs down. Inside
 * it means inside both arcs' circles above the springing line, between the jambs below it.
 */
const ARCH = { r: 136.32, cy: 197.474, left: 160, right: 352, springing: 267.23 } as const;
/** Centres of the arcs: the start arc's circle is centred right of the axis, and the reverse. */
const ARCH_CENTRES = [277.121, 234.879] as const;
/** The tiles' pattern (door-scene.tsx): 24-unit tiles from (244, 44). */
const TILE = { x: 244, y: 44, size: 24 } as const;
/** No glint centred this close to the arch, the frame's edge or the plinth. */
const MARGIN = 4;
/** Radius of the brightened tiles around a glint, and half the flare's box (viewBox units). */
export const GLOW_R = 22;
export const FLARE_R = 14;
/** Glints shown at once, at most. */
export const GLINT_SLOTS = 3;
/** Two glints at once stay at least this far apart, and a spot is not reused this soon. */
const SPREAD = 48;
const RECENT = 6;

export interface Point {
  x: number;
  y: number;
}

export interface Glint extends Point {
  /** How much of FLARE_R the flare reaches. */
  scale: number;
  /** Turn of the flare as it blooms, in degrees (either way). */
  turn: number;
  duration: number;
}

/** Whether a point is inside the arch grown by `margin` (viewBox units). */
export function insideArch({ x, y }: Point, margin = 0): boolean {
  if (y >= ARCH.springing) return x > ARCH.left - margin && x < ARCH.right + margin;
  return ARCH_CENTRES.every((cx) => Math.hypot(x - cx, y - ARCH.cy) < ARCH.r + margin);
}

/**
 * Where a glint may show: the lattice's bright points (the stars' centres, at every half tile on
 * the diagonals, and the tips where they touch), on the tiles and clear of the arch.
 */
export const GLINT_SPOTS: readonly Point[] = (() => {
  const spots: Point[] = [];
  const half = TILE.size / 2;
  const quarter = TILE.size / 4;
  const add = (x: number, y: number) => {
    const inTiles = x >= TILES.x + MARGIN && x <= TILES.x + TILES.width - MARGIN && y >= TILES.y + MARGIN && y <= TILES.y + TILES.height - MARGIN * 3;
    if (inTiles && !insideArch({ x, y }, MARGIN)) spots.push({ x, y });
  };
  for (let i = -12; i <= 12; i++) {
    for (let j = 0; j <= 32; j++) {
      // Star centres: both families of the khatam, on alternate half-tile nodes.
      if ((i + j) % 2 === 0) add(TILE.x + i * half, TILE.y + j * half);
      // Tips where two stars touch, a quarter tile off the nodes.
      add(TILE.x + quarter + i * half, TILE.y + quarter + j * half);
    }
  }
  return spots;
})();

/**
 * The next glint, away from those showing and from the last few spots. Null if none fits (it never
 * happens with GLINT_SLOTS and the lattice's size, but the caller just waits for the next turn).
 */
export function pickGlint(showing: readonly Point[], recent: readonly Point[], random: () => number = Math.random): Glint | null {
  const free = GLINT_SPOTS.filter(
    (spot) => showing.every((other) => Math.hypot(spot.x - other.x, spot.y - other.y) >= SPREAD) && !recent.slice(-RECENT).some((other) => other.x === spot.x && other.y === spot.y),
  );
  const spot = free[Math.floor(random() * free.length)];
  if (!spot) return null;
  return {
    ...spot,
    scale: 0.8 + random() * 0.4,
    turn: (random() < 0.5 ? -1 : 1) * (35 + random() * 55),
    duration: 1100 + random() * 700,
  };
}

/** Wait before the next glint starts, in ms: irregular, so that no rhythm shows. */
export function glintPause(random: () => number = Math.random): number {
  // Mostly a second or two, now and then two glints almost together.
  return random() < 0.15 ? 120 + random() * 250 : 650 + random() * 1700;
}

/** The first glint waits for the gate's entrance (globals.css, welcome-enter: 1.4 s). */
export const FIRST_GLINT_MS = 1700;

const percent = (value: number) => `${(value * 100).toFixed(3)}%`;

/** A square box of radius r around a point, placed in the door's box (CSS left, top, width, height). */
export function glintBox({ x, y }: Point, r: number): { left: string; top: string; width: string; height: string } {
  return {
    left: percent((x - r - DOOR_VIEWBOX.x) / DOOR_VIEWBOX.width),
    top: percent((y - r - DOOR_VIEWBOX.y) / DOOR_VIEWBOX.height),
    width: percent((2 * r) / DOOR_VIEWBOX.width),
    height: percent((2 * r) / DOOR_VIEWBOX.height),
  };
}
