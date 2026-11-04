import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBlockers, stashBlockers } from "@/lib/listings/client/blocker-storage";
import { blockerPassages } from "@/lib/moderation/passages";

// Zone 3 P2-9: the blockers of a refused publication outlive a reload of the tab until settled,
// and the passage at fault can be quoted next to the reason.

function memoryStorage(): Storage {
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

describe("blocker storage", () => {
  beforeEach(() => vi.stubGlobal("sessionStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the blockers of a listing until an empty list settles them", () => {
    const blockers = [{ path: "description", code: "phone_in_text" }];
    stashBlockers("abc", blockers);
    expect(readBlockers("abc")).toEqual(blockers);
    // Read again (a second reload): still there.
    expect(readBlockers("abc")).toEqual(blockers);
    expect(readBlockers("other")).toEqual([]);
    stashBlockers("abc", []);
    expect(readBlockers("abc")).toEqual([]);
  });

  it("drops entries that are not issues and survives unreadable storage", () => {
    sessionStorage.setItem("aalan:blockers:abc", JSON.stringify([{ path: "title", code: "phone_in_text" }, { path: 3 }, "x"]));
    expect(readBlockers("abc")).toEqual([{ path: "title", code: "phone_in_text" }]);
    sessionStorage.setItem("aalan:blockers:abc", "{not json");
    expect(readBlockers("abc")).toEqual([]);
    vi.stubGlobal("sessionStorage", undefined);
    expect(readBlockers("abc")).toEqual([]);
    expect(() => stashBlockers("abc", [{ path: "title", code: "x" }])).not.toThrow();
  });
});

describe("blockerPassages", () => {
  it("quotes the phone number, e-mail or link as written", () => {
    const text = "Vélo en bon état. Appelez le 06 12 34 56 78 ou écrivez à vendeur@example.com, photos sur www.example.ma";
    expect(blockerPassages("phone_in_text", text)).toEqual(["06 12 34 56 78"]);
    expect(blockerPassages("email_in_text", text)).toEqual(["vendeur@example.com"]);
    expect(blockerPassages("url_in_text", text)).toEqual(["www.example.ma"]);
  });

  it("finds nothing once the passage is gone, nor for other codes", () => {
    expect(blockerPassages("phone_in_text", "Vélo en bon état, 2019, 1500 DH.")).toEqual([]);
    expect(blockerPassages("prohibited", "06 12 34 56 78")).toEqual([]);
    expect(blockerPassages("phone_in_text", "")).toEqual([]);
  });
});
