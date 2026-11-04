import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { makeFilterLabels, type LooseTranslator } from "@/components/search/filter-labels";
import { matchSuggestions, readRecentSearches, RECENT_SEARCHES_MAX, withRecentSearch, type Suggestion } from "@/lib/search/suggest-match";
import { buildSuggestions } from "@/lib/search/suggestions";

// Search suggestions while typing (audit §7): the index built from the categories and the
// interpreter's vocabulary, matched on normalized word prefixes; recent searches of the device.

function labels(messages: typeof fr, locale: "fr" | "ar") {
  const t = (namespace: string) => createTranslator({ locale, messages, namespace: namespace as never }) as unknown as LooseTranslator;
  return makeFilterLabels({ chips: t("SearchFilters.chips"), categories: t("Categories"), criteria: t("Criteria"), units: t("Listing.units") }, locale);
}

const frIndex = buildSuggestions(labels(fr, "fr"));
const arIndex = buildSuggestions(labels(ar as typeof fr, "ar"), labels(fr, "fr"));
const shown = (items: Suggestion[]) => items.map((item) => (item.context ? `${item.label} · ${item.context}` : item.label));
const target = (index: Suggestion[], typed: string) => matchSuggestions(index, typed)[0]?.target;

describe("suggestion index", () => {
  it("stays small enough to load on the first focus", () => {
    expect(JSON.stringify(frIndex).length).toBeLessThan(120_000);
    expect(new Set(frIndex.map((item) => JSON.stringify(item.target))).size).toBe(frIndex.length);
  });

  it("opens the filters of a category, a subcategory or a noun", () => {
    expect(target(frIndex, "velo")).toEqual({ query: { categorie: "vehicules", "sous-categorie": "velos" } });
    expect(shown(matchSuggestions(frIndex, "tomob"))).toEqual(["Voitures · Véhicules"]);
    expect(matchSuggestions(frIndex, "frig")[0]).toMatchObject({ label: "Réfrigérateur", context: "Électroménager", kind: "thing" });
    expect(shown(matchSuggestions(frIndex, "ch9a"))).toEqual(["Appartement · Immobilier"]);
  });

  it("searches brands and car models as words", () => {
    expect(matchSuggestions(frIndex, "dac")[0]).toMatchObject({ label: "Dacia", kind: "brand", target: { q: "Dacia" } });
    expect(shown(matchSuggestions(frIndex, "dacia lo"))).toEqual(["Dacia Lodgy · Voitures", "Dacia Logan · Voitures"]);
    expect(target(frIndex, "clio")).toEqual({ q: "Renault Clio" });
  });

  it("matches Arabic script and French words on the Arabic index", () => {
    expect(matchSuggestions(arIndex, "ثلا")[0]?.target).toEqual(matchSuggestions(frIndex, "frigo")[0]?.target);
    expect(matchSuggestions(arIndex, "velo")[0]?.label).toBe(ar.Categories.vehicules.sub.velos);
  });

  it("waits for two letters and ranks a whole word first", () => {
    expect(matchSuggestions(frIndex, "v")).toEqual([]);
    expect(matchSuggestions(frIndex, "  ")).toEqual([]);
    expect(matchSuggestions(frIndex, "tele")[0]?.label).toBe("Téléviseur");
    expect(matchSuggestions(frIndex, "ve").length).toBeLessThanOrEqual(7);
  });
});

describe("recent searches", () => {
  it("keeps the newest first, without duplicates, capped", () => {
    let list: string[] = [];
    for (const q of ["vélo", "Frigo", "velo ", "  ", "a", "b", "c", "d"]) list = withRecentSearch(list, q);
    expect(list).toEqual(["d", "c", "b", "a", "velo"]);
    expect(list).toHaveLength(RECENT_SEARCHES_MAX);
  });

  it("reads a broken or foreign value as empty", () => {
    expect(readRecentSearches({ getItem: () => "not json" })).toEqual([]);
    expect(readRecentSearches({ getItem: () => JSON.stringify({ q: "x" }) })).toEqual([]);
    expect(readRecentSearches({ getItem: () => JSON.stringify(["vélo", 3, "frigo"]) })).toEqual(["vélo", "frigo"]);
    expect(readRecentSearches(undefined)).toEqual([]);
  });
});
