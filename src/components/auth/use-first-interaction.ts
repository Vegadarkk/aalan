"use client";

import { useSyncExternalStore } from "react";

// The first sign of a visitor on the page: a pointer that moves or presses, a key, a touch, a scroll
// or a focus. The sign-up page waits for it before loading Google Identity Services and Turnstile
// (audit zone 8, perf 5: 868 KiB transferred before any action, ~400 KiB of them theirs). A visitor
// who reaches the Google button or the submit button has given one long before.

const EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll", "focusin"] as const;

let seen = false;
const listeners = new Set<() => void>();

function mark() {
  if (seen) return;
  seen = true;
  for (const event of EVENTS) window.removeEventListener(event, mark, { capture: true });
  for (const listener of listeners) listener();
  listeners.clear();
}

/** Calls `listener` once, on the first action seen while subscribed; returns the unsubscribe. */
export function onFirstInteraction(listener: () => void): () => void {
  if (seen) return () => {};
  if (listeners.size === 0) for (const event of EVENTS) window.addEventListener(event, mark, { capture: true, passive: true });
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && !seen) for (const event of EVENTS) window.removeEventListener(event, mark, { capture: true });
  };
}

/** Whether an action was seen (it stays seen until the page reloads). */
export const firstInteractionSeen = (): boolean => seen;

/** False on the server and until the visitor first acts on the page, then true. */
export function useFirstInteraction(): boolean {
  return useSyncExternalStore(onFirstInteraction, firstInteractionSeen, () => false);
}
