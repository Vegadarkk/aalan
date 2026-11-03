// Waves of light across the gate's gilded tiles while the welcome screen waits (owner, 3 Nov 2026:
// "un effet de vague de dorure, comme les reflets d'or sur un objet", not sparkles): now and then a
// soft diagonal band of light glides over the khatam lattice, brightening the gilding as it passes,
// at a random angle, direction, speed and moment. Played by src/components/welcome/glint-layer.ts
// with the Web Animations API (transform only); never under reduced motion, never once the door opens.

import { DOOR_VIEWBOX } from "@/lib/welcome/motion";

/** The gate's frame inside its inner gold line (ALFIZ in door-scene.tsx, inset by 4; the plinth below). */
export const TILES = { x: 114, y: 48, width: 284, height: 366 } as const;

export interface Wave {
  /** Tilt of the band from the vertical, in degrees (its travel is across it). */
  angle: number;
  /** +1: travels towards the band's right (rotated), -1: the other way. */
  direction: 1 | -1;
  /** The band's width, as a share of the tiles' width. */
  width: number;
  /** How bright the gilding gets, 0..1. */
  strength: number;
  duration: number;
}

/** The next wave: a reflection sliding over gold, never twice the same. */
export function pickWave(random: () => number = Math.random): Wave {
  const tilt = 18 + random() * 24;
  return {
    angle: random() < 0.5 ? tilt : -tilt,
    direction: random() < 0.5 ? 1 : -1,
    width: 0.32 + random() * 0.22,
    strength: 0.7 + random() * 0.3,
    duration: 1900 + random() * 1100,
  };
}

/** Wait between two waves, in ms: irregular, so that no rhythm shows. */
export function wavePause(random: () => number = Math.random): number {
  return 1600 + random() * 3400;
}

/** The first wave waits for the gate's entrance (globals.css, welcome-enter: 1.4 s). */
export const FIRST_WAVE_MS = 1600;

/**
 * The band's box and travel for tiles of `width` x `height` px: as long as their diagonal (it
 * crosses them at any angle), centred, and moved from fully outside on one side to the other.
 */
export function waveGeometry(wave: Wave, width: number, height: number): { band: { width: number; height: number }; travel: number } {
  const diagonal = Math.hypot(width, height);
  const band = { width: wave.width * width, height: diagonal * 1.1 };
  return { band, travel: diagonal / 2 + band.width / 2 };
}

const percent = (value: number) => `${(value * 100).toFixed(3)}%`;

/** The tiles' box in the door's box (CSS left, top, width, height). */
export const TILES_BOX = {
  left: percent((TILES.x - DOOR_VIEWBOX.x) / DOOR_VIEWBOX.width),
  top: percent((TILES.y - DOOR_VIEWBOX.y) / DOOR_VIEWBOX.height),
  width: percent(TILES.width / DOOR_VIEWBOX.width),
  height: percent(TILES.height / DOOR_VIEWBOX.height),
} as const;
