"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { timeLeft } from "@/lib/launch/gate";
import { doorSteps, MIN_PUSH_SCALE, pushScale, reducedSteps, type DoorPart } from "@/lib/welcome/motion";
import { markWelcomeSeen } from "@/lib/welcome/flags";
import { doorTilt } from "@/lib/welcome/tilt";
import { playDust } from "@/components/welcome/dust-layer";
import { playGlints } from "@/components/welcome/glint-layer";

// The countdown page's behaviour (src/app/[locale]/(closed)/ouverture): its markup and texts come
// from the server (launch-screen.tsx). While the countdown runs, the door waits shut as on the
// welcome screen: waves of light on its tiles, a lean towards a mouse pointer. At zero the door
// opens by itself (the welcome threshold's timeline, src/lib/welcome/motion.ts) and the page
// reloads into the open site. A page the edge still serves closed after the instant (its cache
// lives up to a minute) says the door is opening and reloads, later each time.

type Phase = "counting" | "opening" | "waiting";

export interface CountdownLabels {
  label: string;
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
  opening: string;
}

/** sessionStorage: reloads made since the instant passed (the edge may serve the closed page a little longer). */
const RETRY_KEY = "launch-retry";
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 30_000;

const part = (root: HTMLElement, name: DoorPart) => root.querySelector<HTMLElement>(`[data-welcome-part='${name}']`);

function retries(): number {
  try {
    return Number(window.sessionStorage.getItem(RETRY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function reloadLater(delay: number): number {
  return window.setTimeout(() => {
    try {
      window.sessionStorage.setItem(RETRY_KEY, String(retries() + 1));
    } catch {
      // Storage unavailable: the next delay stays the first one.
    }
    window.location.reload();
  }, delay);
}

export function LaunchStage({
  opensAt,
  labels,
  numberLocale,
  children,
  tagline,
  after,
}: {
  /** Epoch ms of OPENS_AT. */
  opensAt: number;
  labels: CountdownLabels;
  /** Intl locale of the digits (Latin digits in every locale, as on the rest of the site). */
  numberLocale: string;
  /** The crest and the door. */
  children: ReactNode;
  /** The brand promise, over the countdown. */
  tagline: ReactNode;
  /** The opening date, the social links and the legal links. */
  after: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dust = useRef<HTMLDivElement>(null);
  const phase = useRef<Phase>("counting");
  const stopGlints = useRef<() => void>(() => undefined);
  const stopDust = useRef<() => void>(() => undefined);
  // Null until hydrated: the server's render is cached for up to a minute, its numbers would be stale.
  const [left, setLeft] = useState<ReturnType<typeof timeLeft> | null>(null);
  const [state, setState] = useState<Phase>("counting");

  const open = useCallback(() => {
    const element = root.current;
    if (!element || phase.current !== "counting") return;
    phase.current = "opening";
    setState("opening");
    stopGlints.current();
    const door = part(element, "door");
    door?.style.removeProperty("rotate");
    const box = door?.getBoundingClientRect();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scale = box ? pushScale(box, { width: window.innerWidth, height: window.innerHeight }) : MIN_PUSH_SCALE;
    const steps = reduced ? reducedSteps() : doorSteps({ rtl: document.documentElement.dir === "rtl", scale });
    const played = new Map<DoorPart, Animation>();
    const animations = steps.flatMap((step) => {
      const target = step.part === "ground" ? element : part(element, step.part);
      if (!target) return [];
      const animation = target.animate(step.keyframes, { delay: step.delay, duration: step.duration, easing: step.easing, fill: "both" });
      played.set(step.part, animation);
      return [animation];
    });
    const push = played.get("door");
    const spill = played.get("spill");
    if (dust.current && box && push && spill) stopDust.current = playDust(dust.current, box, push, spill, scale);
    // The visitor has just gone through this door: the open home page does not show its welcome
    // screen again (src/lib/welcome/script.ts).
    markWelcomeSeen();
    // The light fills the screen, then the open site loads in its place.
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => window.location.reload(),
      () => window.location.reload(),
    );
  }, []);

  // The clock: one tick per second, on the second.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const now = Date.now();
      const next = timeLeft(opensAt, now);
      setLeft(next);
      if (next.total > 0) {
        timer = window.setTimeout(tick, 1000 - (now % 1000) + 5);
        return;
      }
      if (phase.current !== "counting") return;
      // Already past on arrival: an edge copy of the closed page. No door: it plays only to a live countdown.
      if (opened.current) open();
      else {
        phase.current = "waiting";
        setState("waiting");
        timer = reloadLater(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retries()));
      }
    };
    const opened = { current: timeLeft(opensAt, Date.now()).total > 0 };
    tick();
    // A tab in the background gets its timers slowed: back in front, the clock catches up at once.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || phase.current !== "counting") return;
      window.clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [opensAt, open]);

  // Waves of light on the tiles while the door waits (never with reduced motion).
  useEffect(() => {
    const layer = root.current?.querySelector<HTMLElement>("[data-welcome-glints]");
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    if (!layer || !motion.matches) return;
    const stop = playGlints(layer);
    stopGlints.current = stop;
    motion.addEventListener("change", stop, { once: true });
    return () => {
      motion.removeEventListener("change", stop);
      stop();
    };
  }, []);

  // The door leans towards a mouse pointer while it waits (welcome-dialog.tsx, issue #199).
  useEffect(() => {
    const door = root.current ? part(root.current, "door") : null;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!door || !fine.matches) return;
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const lean = () => {
      frame = 0;
      if (phase.current === "opening") return;
      if (!pointer) door.style.removeProperty("rotate");
      else door.style.setProperty("rotate", doorTilt(door.getBoundingClientRect(), pointer));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(lean);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useEffect(() => () => stopDust.current(), []);

  const digits = (value: number) => new Intl.NumberFormat(numberLocale, { minimumIntegerDigits: 2, useGrouping: false, numberingSystem: "latn" }).format(value);
  const units = [
    { key: "days", value: left?.days, label: labels.days },
    { key: "hours", value: left?.hours, label: labels.hours },
    { key: "minutes", value: left?.minutes, label: labels.minutes },
    { key: "seconds", value: left?.seconds, label: labels.seconds },
  ] as const;

  return (
    <div ref={root} className="welcome launch" data-state={state} data-testid="launch">
      <div className="m-auto flex w-full max-w-3xl flex-col items-center px-4 py-8 sm:py-10">
        {children}
        <div className="welcome-copy launch-copy flex w-full flex-col items-center text-center" data-welcome-part="copy">
          {tagline}
          <div role="timer" aria-label={labels.label} className="launch-count welcome-enter" data-enter="count" data-ready={left ? "" : undefined}>
            {units.map((unit, index) => (
              <div key={unit.key} className="launch-unit">
                {index > 0 ? <LaunchStar /> : null}
                <span className="launch-digits" dir="ltr">
                  {/* Keyed on the value: each change replays the tick (globals.css). */}
                  <span key={unit.value ?? "pending"} className="launch-digit">
                    {unit.value === undefined ? "00" : unit.key === "days" && unit.value >= 100 ? String(unit.value) : digits(unit.value)}
                  </span>
                </span>
                <span className="launch-unit-label">{unit.label}</span>
              </div>
            ))}
          </div>
          <p className="launch-status" aria-live="polite">
            {state === "counting" ? "" : labels.opening}
          </p>
          {after}
        </div>
      </div>
      <div ref={dust} className="welcome-dust" hidden aria-hidden="true" />
    </div>
  );
}

/** The logo's eight-pointed star between two units. */
function LaunchStar() {
  return (
    <svg className="launch-star" viewBox="56 0 16 16" aria-hidden="true" focusable="false">
      <path d="M64 1.5L65.9 3.4H68.6V6.1L70.5 8L68.6 9.9V12.6H65.9L64 14.5L62.1 12.6H59.4V9.9L57.5 8L59.4 6.1V3.4H62.1Z" />
    </svg>
  );
}
