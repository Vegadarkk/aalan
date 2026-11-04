import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FirstInteraction from "@/components/auth/use-first-interaction";

// The sign-up page loads Google Identity Services and Turnstile on the visitor's first action
// (audit zone 8, perf 5): src/components/auth/use-first-interaction.ts.

type Module = typeof FirstInteraction;

let target: EventTarget;
let load: () => Promise<Module>;

beforeEach(() => {
  target = new EventTarget();
  vi.stubGlobal("window", target);
  vi.resetModules();
  load = () => import("@/components/auth/use-first-interaction");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("first interaction", () => {
  it.each(["pointermove", "pointerdown", "keydown", "touchstart", "wheel", "scroll", "focusin"])("is seen on %s, once", async (type) => {
    const { onFirstInteraction, firstInteractionSeen } = await load();
    const first = vi.fn();
    const second = vi.fn();
    onFirstInteraction(first);
    onFirstInteraction(second);
    expect(firstInteractionSeen()).toBe(false);
    target.dispatchEvent(new Event(type));
    target.dispatchEvent(new Event(type));
    expect(firstInteractionSeen()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores events that are not an action, and listeners that left", async () => {
    const { onFirstInteraction, firstInteractionSeen } = await load();
    const listener = vi.fn();
    const unsubscribe = onFirstInteraction(listener);
    target.dispatchEvent(new Event("load"));
    expect(firstInteractionSeen()).toBe(false);
    unsubscribe();
    target.dispatchEvent(new Event("pointermove"));
    // Nobody listened any more: nothing was seen, nothing called.
    expect(firstInteractionSeen()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stays seen for later subscribers", async () => {
    const { onFirstInteraction, firstInteractionSeen } = await load();
    onFirstInteraction(() => {});
    target.dispatchEvent(new Event("keydown"));
    const late = vi.fn();
    onFirstInteraction(late);
    expect(firstInteractionSeen()).toBe(true);
    expect(late).not.toHaveBeenCalled();
  });
});
