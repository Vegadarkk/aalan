import { afterEach, describe, expect, it, vi } from "vitest";

// "Prix à discuter" remembered per listing for the tab (zone 3 audit P3-4): off unless ticked,
// kept across a return to the step or a reload, and still kept for the visit when storage throws.

function sessionStore(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

async function load() {
  vi.resetModules();
  return import("@/lib/listings/client/price-choice");
}

afterEach(() => vi.unstubAllGlobals());

describe("price-choice", () => {
  it("is off until the seller ticks it, per listing", async () => {
    vi.stubGlobal("window", { sessionStorage: sessionStore() });
    const { readToDiscuss, rememberToDiscuss } = await load();
    expect(readToDiscuss("a")).toBe(false);
    rememberToDiscuss("a", true);
    expect(readToDiscuss("a")).toBe(true);
    expect(readToDiscuss("b")).toBe(false);
    rememberToDiscuss("a", false);
    expect(readToDiscuss("a")).toBe(false);
  });

  it("survives a reload of the tab (session storage)", async () => {
    const storage = sessionStore();
    vi.stubGlobal("window", { sessionStorage: storage });
    (await load()).rememberToDiscuss("a", true);
    expect(storage.getItem("joutiya:price-to-discuss:a")).toBe("1");
    // A fresh module: nothing in memory, the tab's storage answers.
    expect((await load()).readToDiscuss("a")).toBe(true);
  });

  it("keeps the choice for the visit when storage is blocked", async () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    const { readToDiscuss, rememberToDiscuss } = await load();
    expect(readToDiscuss("a")).toBe(false);
    rememberToDiscuss("a", true);
    expect(readToDiscuss("a")).toBe(true);
  });
});
