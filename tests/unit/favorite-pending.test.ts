import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPendingContact, rememberRentalDates } from "@/components/rental/rental-day";
import { PENDING_CLICK_MAX_AGE_MS, favoriteFragment, pendingFavorite, rememberPendingFavorite, takePendingFavorite, withoutPendingFavorite } from "@/lib/favorites/pending";

// The heart clicked before sign-in (audit zone 5 n°8, synthesis §5): it rides in the fragment of
// `next` and is taken once by the heart of that listing after sign-in.

function stubLocation(pathname: string, hash: string) {
  const location = { pathname, search: "", hash };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    const at = url.indexOf("#");
    location.hash = at === -1 ? "" : url.slice(at);
  });
  const stored = new Map<string, string>();
  const localStorage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value), removeItem: (key: string) => void stored.delete(key) };
  vi.stubGlobal("window", { location, history: { state: null, replaceState }, localStorage });
  return { location, replaceState, stored };
}

afterEach(() => vi.unstubAllGlobals());

describe("pending favorite fragment", () => {
  it("adds the listing to the fragment and keeps the other keys", () => {
    expect(favoriteFragment("", "abcd2345")).toBe("#favori=abcd2345");
    expect(favoriteFragment("#du=2026-11-10&au=2026-11-14", "abcd2345")).toBe("#du=2026-11-10&au=2026-11-14&favori=abcd2345");
    expect(pendingFavorite("#du=2026-11-10&au=2026-11-14&favori=abcd2345")).toBe("abcd2345");
    expect(withoutPendingFavorite("#du=2026-11-10&au=2026-11-14&favori=abcd2345")).toBe("#du=2026-11-10&au=2026-11-14");
    expect(withoutPendingFavorite("#favori=abcd2345")).toBe("");
  });

  it("ignores anything that is not a listing id", () => {
    expect(pendingFavorite("#favori=../admin")).toBeNull();
    expect(pendingFavorite("#favori=ABCD2345")).toBeNull();
    expect(pendingFavorite("")).toBeNull();
  });

  it("is taken once, by the heart of that listing only", () => {
    const { location, replaceState } = stubLocation("/fr/recherche", "#favori=abcd2345");
    rememberPendingFavorite("abcd2345");
    expect(takePendingFavorite("wxyz6789")).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(takePendingFavorite("abcd2345")).toBe(true);
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/fr/recherche");
    expect(location.hash).toBe("");
    // A second heart of the same listing on the page finds nothing left.
    expect(takePendingFavorite("abcd2345")).toBe(false);
  });

  it("never adds a favorite from a link alone: the click marker of this browser must name it, recently", () => {
    const { location, stored } = stubLocation("/fr/annonce/riad-abcd2345", "#favori=abcd2345");
    expect(takePendingFavorite("abcd2345")).toBe(false);
    // The key still leaves the address bar.
    expect(location.hash).toBe("");
    location.hash = "#favori=abcd2345";
    rememberPendingFavorite("wxyz6789");
    expect(takePendingFavorite("abcd2345")).toBe(false);
    location.hash = "#favori=abcd2345";
    rememberPendingFavorite("abcd2345", 1_000);
    expect(takePendingFavorite("abcd2345", 1_000 + PENDING_CLICK_MAX_AGE_MS)).toBe(false);
    expect(stored.size).toBe(0);
    location.hash = "#favori=abcd2345";
    rememberPendingFavorite("abcd2345", 1_000);
    expect(takePendingFavorite("abcd2345", 2_000)).toBe(true);
    // Used up: the same link opened again adds nothing.
    location.hash = "#favori=abcd2345";
    expect(takePendingFavorite("abcd2345", 3_000)).toBe(false);
  });

  it("survives the rental fragment helpers of the listing page", () => {
    const { location } = stubLocation("/fr/annonce/riad-abcd2345", "#du=2026-11-10&au=2026-11-14&contact=rental&favori=abcd2345");
    clearPendingContact();
    expect(location.hash).toBe("#du=2026-11-10&au=2026-11-14&favori=abcd2345");
    rememberRentalDates({ from: "2026-11-11", to: "2026-11-15" });
    expect(pendingFavorite(location.hash)).toBe("abcd2345");
  });
});
