import { FIRST_GLINT_MS, FLARE_R, GLOW_R, glintBox, glintPause, pickGlint, type Point } from "@/lib/welcome/glints";

// Random glints on the gate's tiles while the welcome screen waits (src/lib/welcome/glints.ts). The
// slots are in the door's markup (door-scene.tsx): each one a patch of brighter tiles and a flare,
// moved to a new spot between two glints (a small repaint while hidden), then faded in and out by
// their opacity and transform only. Returns the function that stops them.

type Slot = { glow: SVGSVGElement; mask: SVGCircleElement; flare: SVGSVGElement; busy: Point | null; animations: Animation[] };

/** Each step of a glint eases in and out on its own (an easing on the whole would shift the peak). */
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

export function playGlints(layer: HTMLElement, random: () => number = Math.random): () => void {
  const slots: Slot[] = [...layer.querySelectorAll<HTMLElement>("[data-glint]")].flatMap((slot) => {
    const glow = slot.querySelector<SVGSVGElement>(".welcome-glint-glow");
    const mask = slot.querySelector<SVGCircleElement>("mask circle");
    const flare = slot.querySelector<SVGSVGElement>(".welcome-glint-flare");
    return glow && mask && flare ? [{ glow, mask, flare, busy: null, animations: [] }] : [];
  });
  const recent: Point[] = [];
  let timer = 0;
  let stopped = false;

  const show = () => {
    if (stopped) return;
    const slot = slots.find((candidate) => !candidate.busy);
    const glint = slot ? pickGlint(slots.flatMap((other) => (other.busy ? [other.busy] : [])), recent, random) : null;
    if (slot && glint) {
      slot.busy = glint;
      recent.push(glint);
      if (recent.length > 12) recent.shift();
      Object.assign(slot.glow.style, glintBox(glint, GLOW_R));
      slot.glow.setAttribute("viewBox", `${glint.x - GLOW_R} ${glint.y - GLOW_R} ${GLOW_R * 2} ${GLOW_R * 2}`);
      slot.mask.setAttribute("cx", String(glint.x));
      slot.mask.setAttribute("cy", String(glint.y));
      Object.assign(slot.flare.style, glintBox(glint, FLARE_R));
      const timing = { duration: glint.duration };
      const glow = slot.glow.animate([{ opacity: 0, easing: EASE }, { opacity: 1, offset: 0.4, easing: EASE }, { opacity: 0 }], timing);
      // The flare blooms a little after the tiles catch the light, and is gone first.
      const flare = slot.flare.animate(
        [
          { opacity: 0, transform: "scale(0) rotate(0deg)" },
          { opacity: 0, transform: "scale(0) rotate(0deg)", offset: 0.15, easing: EASE },
          { opacity: 1, transform: `scale(${glint.scale.toFixed(3)}) rotate(${(glint.turn / 2).toFixed(1)}deg)`, offset: 0.45, easing: EASE },
          { opacity: 0, transform: `scale(0.2) rotate(${glint.turn.toFixed(1)}deg)`, offset: 0.85 },
          { opacity: 0, transform: `scale(0) rotate(${glint.turn.toFixed(1)}deg)` },
        ],
        timing,
      );
      slot.animations = [glow, flare];
      glow.finished.then(
        () => {
          slot.busy = null;
          slot.animations = [];
        },
        () => undefined,
      );
    }
    timer = window.setTimeout(show, glintPause(random));
  };

  if (slots.length > 0) timer = window.setTimeout(show, FIRST_GLINT_MS);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    for (const slot of slots) for (const animation of slot.animations) animation.cancel();
  };
}
