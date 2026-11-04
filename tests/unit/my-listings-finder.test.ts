import { describe, expect, it } from "vitest";
import { FINDER_MIN_ROWS, NO_FIND, findListings, finderShown, rowCategories } from "@/components/listings/owner/listings-finder";
import type { OwnerListingSummary } from "@/lib/contracts/listings";

// Search of « Mes annonces » (audit §7): title and city words, folded; category; shown from a handful of rows.

function row(id: string, title: string, citySlug: string | null, categoryId: string | null): OwnerListingSummary {
  return { id, title, citySlug, categoryId } as OwnerListingSummary;
}

const rows = [
  row("a", "Dacia Logan 2019 diesel", "casablanca", "vehicules"),
  row("b", "Renault Clio 4 essence", "rabat", "vehicules"),
  row("c", "Réfrigérateur Samsung", "casablanca", "maison-jardin"),
  row("d", "Vélo électrique", "marrakech", null),
];
const ids = (list: OwnerListingSummary[]) => list.map((item) => item.id);

describe("findListings", () => {
  it("keeps every row without a search", () => {
    expect(ids(findListings(rows, NO_FIND, "fr"))).toEqual(["a", "b", "c", "d"]);
  });

  it("matches every word in the title or the city, accents and case folded", () => {
    expect(ids(findListings(rows, { q: "refrigerateur", categoryId: null }, "fr"))).toEqual(["c"]);
    expect(ids(findListings(rows, { q: "LOGAN diesel", categoryId: null }, "fr"))).toEqual(["a"]);
    expect(ids(findListings(rows, { q: "casa", categoryId: null }, "fr"))).toEqual(["a", "c"]);
    expect(ids(findListings(rows, { q: "clio casablanca", categoryId: null }, "fr"))).toEqual([]);
  });

  it("finds the Arabic city name on the Arabic page", () => {
    expect(ids(findListings(rows, { q: "الرباط", categoryId: null }, "ar"))).toEqual(["b"]);
  });

  it("filters on the category, alone or with words", () => {
    expect(ids(findListings(rows, { q: "", categoryId: "vehicules" }, "fr"))).toEqual(["a", "b"]);
    expect(ids(findListings(rows, { q: "casa", categoryId: "vehicules" }, "fr"))).toEqual(["a"]);
    expect(rowCategories(rows)).toEqual(["vehicules", "maison-jardin"]);
  });

  it("shows from a handful of rows, or while searching", () => {
    expect(finderShown(rows, NO_FIND)).toBe(rows.length >= FINDER_MIN_ROWS);
    expect(finderShown(rows.slice(0, 1), { q: "x", categoryId: null })).toBe(true);
    expect(finderShown(Array.from({ length: FINDER_MIN_ROWS }, (_, index) => row(String(index), "t", null, null)), NO_FIND)).toBe(true);
  });
});
