"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useNumbersTranslations } from "@/i18n/numbers";
import { TOURS, type TourId, type TourStep } from "@/lib/tours/catalog";
import { cn } from "@/lib/utils";

// The guided tour itself (owner, 2026-11-11): the page dims under a blurred veil with one hole,
// the element of the step stays sharp in that hole inside a gold halo (the light through the
// door), and a card beside it says what to do. Steps whose element is missing are left out; an
// element that goes away during its step (a click that changed the screen) moves the tour on.
//
// Geometry runs in one requestAnimationFrame loop that writes styles directly (no re-render per
// frame): the veil's clip-path, the halo and the card glide together from one step to the next,
// and follow the page while it scrolls. Reduced motion: no glide, no breathing halo.

export type TourOutcome = "done" | "skipped" | "left" | "empty";

export interface TourOverlayProps {
  tour: TourId;
  onClose: (outcome: TourOutcome) => void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room around the element inside the hole, px. */
const PAD = 8;
/** Corner radius of the hole and halo, px. */
const RADIUS = 14;
/** Gap between the hole and the card, px. */
const GAP = 16;
/** Margin kept from the viewport's edges, px. */
const EDGE = 12;
/** Below this width the card docks to the top or bottom edge. */
const PHONE = 640;
/** Glide between two steps, ms. */
const GLIDE = 380;
/** How long the first element may take to appear (data loaded by the screen), ms. */
const WAIT_FIRST = 8000;
/** Extra time for the other elements once the first is there, ms. */
const SETTLE = 350;

function visibleTarget(target: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const ease = (t: number) => 1 - (1 - t) ** 4;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** The hole: the element's box with its padding, kept inside the viewport. */
function holeOf(element: HTMLElement, vw: number, vh: number): Box {
  const rect = element.getBoundingClientRect();
  const x = clamp(rect.left - PAD, 4, vw - 8);
  const y = clamp(rect.top - PAD, 4, vh - 8);
  const right = clamp(rect.right + PAD, x + 4, vw - 4);
  const bottom = clamp(rect.bottom + PAD, y + 4, vh - 4);
  return { x, y, w: right - x, h: bottom - y };
}

function roundedRect({ x, y, w, h }: Box): string {
  const r = Math.min(RADIUS, w / 2, h / 2);
  const f = (n: number) => n.toFixed(1);
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

type Placement = { x: number; y: number; arrow: "top" | "bottom" | null; arrowX: number };

/** Where the card goes for a hole: under it, else above, else docked; a phone docks it. */
function placeCard(hole: Box, cw: number, ch: number, vw: number, vh: number): Placement {
  const center = hole.x + hole.w / 2;
  if (vw < PHONE) {
    const top = hole.y + hole.h / 2 > vh * 0.55;
    return { x: EDGE, y: top ? EDGE : vh - ch - EDGE, arrow: null, arrowX: 0 };
  }
  const x = clamp(center - cw / 2, EDGE, vw - cw - EDGE);
  const arrowX = clamp(center - x, 24, cw - 24);
  if (hole.y + hole.h + GAP + ch <= vh - EDGE) return { x, y: hole.y + hole.h + GAP, arrow: "top", arrowX };
  if (hole.y - GAP - ch >= EDGE) return { x, y: hole.y - GAP - ch, arrow: "bottom", arrowX };
  return { x: clamp((vw - cw) / 2, EDGE, vw - cw - EDGE), y: vh - ch - EDGE, arrow: null, arrowX: 0 };
}

/** Brings the element where the card leaves it visible; nothing when it already is. */
function bringIntoView(element: HTMLElement, cardHeight: number): void {
  const rect = element.getBoundingClientRect();
  const vh = window.innerHeight;
  const phone = window.innerWidth < PHONE;
  // Under the sticky header; on a phone, out of the card docked at the bottom.
  const top = 88;
  const bottom = vh - (phone ? cardHeight + 2 * EDGE : EDGE);
  if (rect.top >= top && rect.bottom <= bottom) return;
  // A fixed element (a sticky bar) does not move with the page: leave the page where it is.
  if (getComputedStyle(element).position === "fixed") return;
  const room = bottom - top;
  const offset = rect.height >= room ? rect.top - top : rect.top - top - (room - rect.height) / 2;
  window.scrollBy({ top: offset, behavior: reducedMotion() ? "auto" : "smooth" });
}

export function TourOverlay({ tour, onClose }: TourOverlayProps) {
  const t = useTranslations("Tours");
  // Prints numbers: Tarifit formats them as French (src/i18n/numbers.ts).
  const counter = useNumbersTranslations("Tours.card");
  const titleId = useId();
  const bodyId = useId();
  const veil = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const [steps, setSteps] = useState<readonly TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const closed = useRef(false);
  const shown = useRef(false);
  const opener = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  const close = useCallback((outcome: TourOutcome) => {
    if (closed.current) return;
    closed.current = true;
    onCloseRef.current(outcome);
  }, []);

  // Which steps can show: wait for the first element (the screen may still load its data), give
  // the others a moment, keep those present.
  useEffect(() => {
    const all = TOURS[tour];
    let settleTimer = 0;
    const observer = new MutationObserver(check);
    const giveUp = window.setTimeout(() => finish(), WAIT_FIRST);
    function finish() {
      observer.disconnect();
      window.clearTimeout(giveUp);
      window.clearTimeout(settleTimer);
      const present = all.filter((step) => visibleTarget(step.target));
      if (present.length === 0) close("empty");
      else setSteps(present);
    }
    function check() {
      if (settleTimer || !all.some((step) => visibleTarget(step.target))) return;
      settleTimer = window.setTimeout(finish, SETTLE);
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tour", "class", "hidden"] });
    check();
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
      window.clearTimeout(settleTimer);
    };
  }, [tour, close]);

  // Leaving the screen with the tour open counts as having seen it; the focus goes back.
  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      if (shown.current) close("left");
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [close]);

  const step = steps?.[index] ?? null;
  const last = steps !== null && index === steps.length - 1;

  const next = useCallback(() => {
    if (!steps) return;
    if (index >= steps.length - 1) close("done");
    else setIndex(index + 1);
  }, [close, index, steps]);

  // Each step: the element into view and the focus on the card (its title and text are read out).
  useLayoutEffect(() => {
    if (!step) return;
    shown.current = true;
    const element = visibleTarget(step.target);
    if (element) bringIntoView(element, card.current?.offsetHeight ?? 220);
    card.current?.focus({ preventScroll: true });
  }, [step]);

  // The frame loop: hole, halo, card and arrow follow the element; a step change glides.
  useEffect(() => {
    if (!step) return;
    const still = reducedMotion();
    let frame = 0;
    let from: Box | null = null;
    let current: Box | null = null;
    let started = performance.now();
    let missing = 0;
    let lastKey = "";
    const veilEl = veil.current;
    const haloEl = halo.current;
    const cardEl = card.current;
    const arrowEl = arrow.current;
    if (!veilEl || !haloEl || !cardEl || !arrowEl) return;
    // The previous step's hole is where the glide starts from.
    const previous = haloEl.dataset.box ? (JSON.parse(haloEl.dataset.box) as Box) : null;
    from = previous;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const element = visibleTarget(step.target);
      if (!element) {
        // Gone for a few frames (the click changed the screen): on to the next step.
        if (++missing > 20) {
          cancelAnimationFrame(frame);
          next();
        }
        return;
      }
      missing = 0;
      const target = holeOf(element, vw, vh);
      const progress = still || !from ? 1 : Math.min(1, (now - started) / GLIDE);
      const k = ease(progress);
      current = from && progress < 1 ? { x: lerp(from.x, target.x, k), y: lerp(from.y, target.y, k), w: lerp(from.w, target.w, k), h: lerp(from.h, target.h, k) } : target;
      if (progress >= 1) from = null;
      const cw = cardEl.offsetWidth;
      const ch = cardEl.offsetHeight;
      const place = placeCard(current, cw, ch, vw, vh);
      const key = `${vw}|${vh}|${current.x.toFixed(1)}|${current.y.toFixed(1)}|${current.w.toFixed(1)}|${current.h.toFixed(1)}|${cw}|${ch}`;
      if (key === lastKey) return;
      lastKey = key;
      veilEl.style.clipPath = `path(evenodd, "M0 0H${vw}V${vh}H0Z${roundedRect(current)}")`;
      haloEl.style.transform = `translate(${current.x}px, ${current.y}px)`;
      haloEl.style.width = `${current.w}px`;
      haloEl.style.height = `${current.h}px`;
      haloEl.dataset.box = JSON.stringify(target);
      cardEl.style.transform = `translate(${place.x}px, ${place.y}px)`;
      cardEl.dataset.ready = "true";
      arrowEl.dataset.side = place.arrow ?? "none";
      arrowEl.style.left = `${place.arrowX}px`;
    };
    started = performance.now();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step, next]);

  // Keyboard: Escape skips, Tab stays in the card, the arrows move between steps.
  useEffect(() => {
    if (!steps) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close("skipped");
        return;
      }
      const cardEl = card.current;
      if (!cardEl || !cardEl.contains(document.activeElement)) return;
      if (event.key === "Tab") {
        const focusables = [...cardEl.querySelectorAll<HTMLElement>("button:not(:disabled)")];
        if (focusables.length === 0) return;
        const first = focusables[0];
        const lastOne = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === cardEl)) {
          event.preventDefault();
          lastOne?.focus();
        } else if (!event.shiftKey && document.activeElement === lastOne) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, steps]);

  if (!steps || !step) return null;
  const total = steps.length;

  return createPortal(
    <div className="tour" data-testid="tour" data-tour-id={tour}>
      {/* Clicks on the veil do nothing; the hole lets them through to the element. */}
      <div ref={veil} className="tour-veil" aria-hidden="true" />
      <div ref={halo} className="tour-halo" aria-hidden="true" />
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} className="tour-card" data-testid="tour-card">
        <span ref={arrow} className="tour-arrow" aria-hidden="true" />
        <div className="flex items-start gap-3">
          <span className="tour-star mt-0.5" aria-hidden="true" />
          <p className="flex-1 pt-px text-sm font-medium text-foreground-muted tabular-nums">{counter("step", { current: index + 1, total })}</p>
          <button type="button" onClick={() => close("skipped")} aria-label={t("card.close")} className="-me-2 -mt-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div key={step.target} className="tour-text mt-1 flex flex-col gap-1.5">
          <h2 id={titleId} className="text-lg font-semibold text-balance">
            {t(`steps.${step.target}.title`)}
          </h2>
          <p id={bodyId} className="text-pretty text-foreground-muted">
            {t(`steps.${step.target}.body`)}
          </p>
        </div>
        <div className="mt-5 flex items-center gap-3">
          {total > 1 ? (
            <ol className="flex flex-1 items-center gap-1.5" aria-hidden="true">
              {steps.map((item, position) => (
                <li key={item.target} className={cn("tour-dot", position === index && "tour-dot-current", position < index && "tour-dot-done")} />
              ))}
            </ol>
          ) : (
            <span className="flex-1" />
          )}
          {index > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setIndex(index - 1)} aria-label={t("card.previous")} className="px-2.5">
              <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => close("skipped")} className="text-foreground-muted">
              {t("card.skip")}
            </Button>
          )}
          <Button type="button" size="sm" onClick={next} data-testid="tour-next" className="min-w-24">
            {last ? t("card.done") : t("card.next")}
            {last ? <Check aria-hidden="true" /> : <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
