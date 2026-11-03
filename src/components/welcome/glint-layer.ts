import { FIRST_WAVE_MS, pickWave, waveGeometry, wavePause } from "@/lib/welcome/glints";

// Waves of light over the gate's tiles while the welcome screen waits (src/lib/welcome/glints.ts).
// Markup in door-scene.tsx: the tiles' box clips a band (soft-edged by a mask, with a warm glow),
// which holds a brighter copy of the whole lattice. The band turns and slides across; its copy of
// the lattice makes the inverse move, so that it stays in place under the band: only transforms
// change, the lattice is drawn once. Returns the function that stops the waves.

const EASE = "cubic-bezier(0.45, 0, 0.3, 1)";

export function playGlints(layer: HTMLElement, random: () => number = Math.random): () => void {
  const band = layer.querySelector<HTMLElement>("[data-glint-band]");
  const tiles = band?.querySelector<SVGSVGElement>("svg");
  let timer = 0;
  let stopped = false;
  let playing: Animation[] = [];

  const wave = () => {
    if (stopped || !band || !tiles) return;
    // Layout sizes: the door's lean towards the pointer does not change them.
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;
    if (width > 0 && height > 0) {
      const next = pickWave(random);
      const { band: box, travel } = waveGeometry(next, width, height);
      Object.assign(band.style, {
        width: `${box.width}px`,
        height: `${box.height}px`,
        left: `${(width - box.width) / 2}px`,
        top: `${(height - box.height) / 2}px`,
      });
      // The lattice copy covers the tiles' box exactly, from inside the band.
      Object.assign(tiles.style, {
        width: `${width}px`,
        height: `${height}px`,
        left: `${(box.width - width) / 2}px`,
        top: `${(box.height - height) / 2}px`,
      });
      const from = -travel * next.direction;
      const to = travel * next.direction;
      const timing = { duration: next.duration, easing: EASE };
      const strength = next.strength.toFixed(2);
      playing = [
        band.animate(
          [
            { transform: `rotate(${next.angle}deg) translateX(${from}px)`, opacity: strength },
            { transform: `rotate(${next.angle}deg) translateX(${to}px)`, opacity: strength },
          ],
          timing,
        ),
        tiles.animate(
          [{ transform: `translateX(${-from}px) rotate(${-next.angle}deg)` }, { transform: `translateX(${-to}px) rotate(${-next.angle}deg)` }],
          timing,
        ),
      ];
      timer = window.setTimeout(wave, next.duration + wavePause(random));
      return;
    }
    timer = window.setTimeout(wave, wavePause(random));
  };

  if (band && tiles) timer = window.setTimeout(wave, FIRST_WAVE_MS);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    for (const animation of playing) animation.cancel();
  };
}
