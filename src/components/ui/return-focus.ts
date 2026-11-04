"use client";

import { useLayoutEffect, useRef } from "react";

// Radix Dialog gives the focus back to its Dialog.Trigger when it closes. A dialog opened another
// way (a state change, an event, a menu item, a button that turns busy while its chunk loads) has no
// trigger, and the focus falls to <body>: a keyboard or screen reader user starts again from the top
// of the page (audit zone 8, 5.2-1; zone 5, 17). This hook returns the dialog's onCloseAutoFocus.

/** The first candidate that can still take the focus: in the page and not disabled. */
export function returnTarget(...candidates: (Element | null | undefined)[]): HTMLElement | null {
  for (const candidate of candidates) {
    if (candidate instanceof HTMLElement && candidate.isConnected && !candidate.matches(":disabled")) return candidate;
  }
  return null;
}

/**
 * onCloseAutoFocus for a dialog without a Dialog.Trigger: the focus goes back to `opener()` (the
 * button that opened it), else to the element that held it when the dialog opened, else Radix's
 * default. Layout effects run before Radix moves the focus into the dialog (a passive effect).
 */
export function useReturnFocus(open: boolean, opener?: () => HTMLElement | null | undefined): (event: Event) => void {
  const before = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (open) before.current = document.activeElement === document.body ? null : document.activeElement;
  }, [open]);
  return (event: Event) => {
    const target = returnTarget(opener?.(), before.current);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
}
