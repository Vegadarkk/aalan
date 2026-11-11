import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { tutorialSettingsSchema } from "@/lib/contracts/account";
import { EMPTY_TOUR_STATE, TOURS, TOUR_IDS, TOUR_TARGETS, TUTORIALS, cleanSeen, mergeTourStates, shouldStart, tutorialById, tutorialHref, tutorialOf, tutorialStepCount, withReplay } from "@/lib/tours/catalog";

vi.mock("@/lib/auth/client", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

describe("tour catalogue", () => {
  it("gives every tour to exactly one tutorial and every step its texts in French and Arabic", () => {
    for (const id of TOUR_IDS) expect(TUTORIALS.filter((tutorial) => tutorial.tours.includes(id)), id).toHaveLength(1);
    for (const target of TOUR_TARGETS) {
      for (const messages of [fr, ar]) {
        const step = (messages.Tours.steps as Record<string, { title?: string; body?: string }>)[target];
        expect(step?.title, target).toBeTruthy();
        expect(step?.body, target).toBeTruthy();
      }
    }
    for (const tutorial of TUTORIALS) expect((fr.Tours.tutorials as Record<string, unknown>)[tutorial.id], tutorial.id).toBeTruthy();
  });

  it("points every step at an element some screen marks with data-tour", () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (file.endsWith(".tsx")) sources.push(readFileSync(file, "utf8"));
      }
    };
    walk(path.resolve(__dirname, "../../src/components"));
    const all = sources.join("\n");
    const used = new Set(Object.values(TOURS).flatMap((steps) => steps.map((step) => step.target)));
    expect([...used].sort()).toEqual([...TOUR_TARGETS].sort());
    for (const target of TOUR_TARGETS) expect(all.includes(`"${target}"`), target).toBe(true);
    for (const id of TOUR_IDS) expect(all.includes(`<GuidedTour id="${id}"`) || all.includes(`id="${id}" />`), id).toBe(true);
  });

  it("starts an unseen tour while tours are on, and a replayed one even when they are off", () => {
    expect(shouldStart("post-start", EMPTY_TOUR_STATE, null)).toBe(true);
    expect(shouldStart("post-start", { seen: ["post-start"], off: false }, null)).toBe(false);
    expect(shouldStart("post-start", { seen: [], off: true }, null)).toBe(false);
    expect(shouldStart("post-start", { seen: [], off: true }, "deposer")).toBe(true);
    // A replay brings back its own tutorial's tours only.
    expect(shouldStart("pro-apply", { seen: [], off: true }, "deposer")).toBe(false);
    expect(shouldStart("post-start", { seen: ["post-start"], off: true }, "deposer")).toBe(false);
  });

  it("merges and cleans the lists, replays a tutorial and builds its link", () => {
    expect(cleanSeen(["pro-shop", "nope", "post-start", "pro-shop"])).toEqual(["post-start", "pro-shop"]);
    expect(mergeTourStates({ seen: ["post-start"], off: false }, { seen: ["pro-apply"], off: true })).toEqual({ seen: ["post-start", "pro-apply"], off: true });
    const deposer = tutorialById("deposer");
    if (!deposer) throw new Error("missing tutorial");
    expect(withReplay({ seen: ["post-start", "post-review", "pro-apply"], off: true }, deposer)).toEqual({ seen: ["pro-apply"], off: true });
    expect(tutorialHref(deposer)).toEqual({ pathname: "/deposer", query: { nouveau: "1", tuto: "deposer" } });
    expect(tutorialStepCount(deposer)).toBe(7);
    expect(tutorialOf("pro-shop")?.id).toBe("boutique");
    expect(tutorialById("x")).toBeNull();
  });

  it("accepts known tour ids only in the API body", () => {
    expect(tutorialSettingsSchema.safeParse({ seen: ["post-start"], off: true }).success).toBe(true);
    expect(tutorialSettingsSchema.safeParse({ seen: ["unknown"] }).success).toBe(false);
    expect(tutorialSettingsSchema.safeParse({ off: true, extra: 1 }).success).toBe(false);
  });
});

/** A browser just big enough for src/lib/tours/client.ts. */
function fakeBrowser(href: string) {
  const store = (): Storage => {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    };
  };
  const location = { href };
  const history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url: URL) => {
      location.href = url.toString();
    },
  };
  vi.stubGlobal("window", { localStorage: store(), sessionStorage: store(), location, history });
  return location;
}

describe("tour state in the browser", () => {
  beforeEach(async () => {
    const client = await import("@/lib/tours/client");
    client.resetTourClientForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a guest's tour once on this device", async () => {
    fakeBrowser("https://aalan.test/fr/deposer");
    const { markTourSeen, tourShouldStart } = await import("@/lib/tours/client");
    expect(await tourShouldStart("post-start", false)).toBe(true);
    markTourSeen("post-start", false);
    expect(await tourShouldStart("post-start", false)).toBe(false);
    expect(await tourShouldStart("post-wizard", false)).toBe(true);
  });

  it("asks the account once and follows its switch", async () => {
    fakeBrowser("https://aalan.test/fr/pro");
    const auth = await import("@/lib/auth/client");
    vi.mocked(auth.apiGet).mockResolvedValue({ seen: ["pro-apply"], off: false });
    const { tourShouldStart } = await import("@/lib/tours/client");
    expect(await tourShouldStart("pro-apply", true)).toBe(false);
    expect(await tourShouldStart("pro-shop", true)).toBe(true);
    expect(auth.apiGet).toHaveBeenCalledTimes(1);
  });

  it("replays a tutorial from ?tuto=, even with tours off, then drops the parameter", async () => {
    const location = fakeBrowser("https://aalan.test/fr/deposer?nouveau=1&tuto=deposer");
    const auth = await import("@/lib/auth/client");
    vi.mocked(auth.apiGet).mockResolvedValue({ seen: ["post-start", "post-wizard"], off: true });
    vi.mocked(auth.apiPost).mockResolvedValue({ seen: ["post-start", "post-wizard"], off: true });
    const { markTourSeen, readDeviceState, tourShouldStart, writeDeviceState } = await import("@/lib/tours/client");
    writeDeviceState({ seen: ["post-start", "post-wizard"], off: true });
    expect(await tourShouldStart("post-start", true)).toBe(true);
    expect(location.href).toBe("https://aalan.test/fr/deposer?nouveau=1");
    expect(readDeviceState().seen).toEqual([]);
    // Another screen of the same tutorial during the replay.
    expect(await tourShouldStart("post-wizard", true)).toBe(true);
    // Not the other tutorials while tours are off.
    expect(await tourShouldStart("pro-apply", true)).toBe(false);
    markTourSeen("post-start", true);
    expect(await tourShouldStart("post-start", true)).toBe(false);
  });

  it("queues tours: one at a time", async () => {
    const { acquireTourSlot } = await import("@/lib/tours/client");
    const order: string[] = [];
    const first = await acquireTourSlot();
    const second = acquireTourSlot().then((release) => {
      order.push("second");
      return release;
    });
    await Promise.resolve();
    order.push("first done");
    first();
    (await second)();
    expect(order).toEqual(["first done", "second"]);
  });
});
