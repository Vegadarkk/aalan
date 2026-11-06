// Waves of light over the gate's gilded tiles, as on the countdown page: a plain copy of
// src/components/welcome/glint-layer.ts and src/lib/welcome/glints.ts (pickWave, wavePause,
// waveGeometry), served at /hold/glints.js. Never under reduced motion.
(() => {
  const layer = document.querySelector("[data-welcome-glints]");
  const band = layer && layer.querySelector("[data-glint-band]");
  const tiles = band && band.querySelector("svg");
  if (!tiles || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches || !band.animate) return;
  const EASE = "cubic-bezier(0.45, 0, 0.3, 1)";
  const FIRST_WAVE_MS = 1600;
  const pause = () => 1600 + Math.random() * 3400;
  const pick = () => {
    const tilt = 18 + Math.random() * 24;
    return {
      angle: Math.random() < 0.5 ? tilt : -tilt,
      direction: Math.random() < 0.5 ? 1 : -1,
      width: 0.32 + Math.random() * 0.22,
      strength: 0.7 + Math.random() * 0.3,
      duration: 1900 + Math.random() * 1100,
    };
  };
  const wave = () => {
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;
    if (width > 0 && height > 0) {
      const next = pick();
      const diagonal = Math.hypot(width, height);
      const box = { width: next.width * width, height: diagonal * 1.1 };
      const travel = diagonal / 2 + box.width / 2;
      Object.assign(band.style, { width: `${box.width}px`, height: `${box.height}px`, left: `${(width - box.width) / 2}px`, top: `${(height - box.height) / 2}px` });
      Object.assign(tiles.style, { width: `${width}px`, height: `${height}px`, left: `${(box.width - width) / 2}px`, top: `${(box.height - height) / 2}px` });
      const from = -travel * next.direction;
      const to = travel * next.direction;
      const timing = { duration: next.duration, easing: EASE };
      const strength = next.strength.toFixed(2);
      band.animate(
        [
          { transform: `rotate(${next.angle}deg) translateX(${from}px)`, opacity: strength },
          { transform: `rotate(${next.angle}deg) translateX(${to}px)`, opacity: strength },
        ],
        timing,
      );
      tiles.animate([{ transform: `translateX(${-from}px) rotate(${-next.angle}deg)` }, { transform: `translateX(${-to}px) rotate(${-next.angle}deg)` }], timing);
      window.setTimeout(wave, next.duration + pause());
      return;
    }
    window.setTimeout(wave, pause());
  };
  window.setTimeout(wave, FIRST_WAVE_MS);
})();
