import { describe, expect, it } from "vitest";
import { subcategoryById } from "@/config/categories";
import { DEMO_ENTRIES } from "@/lib/demo/catalog";
import { demoListingId } from "@/lib/demo/data";
import { entryLanguage, entryTexts, exampleSearchTitles, exampleTitlesField, localizeExample } from "@/lib/demo/localized";
import { DEMO_TRANSLATIONS } from "@/lib/demo/translations";
import { shownTitle } from "@/lib/examples/title";
import { containsProhibited } from "@/lib/moderation/prohibited";
import { toSearchCard } from "@/lib/search/cards";
import type { CardDocument } from "@/lib/search/types";

// Example listings in the page language (owner, 2026-11-04): every entry has a French and an
// Arabic text, cards and pages pick the page's, a member's listing is never touched.

const ARABIC = /[؀-ۿ]/;
const NOW = new Date("2026-11-04T10:00:00Z");

describe("example translations", () => {
  it("translate every entry into its other language, and nothing else", () => {
    const keys = new Set(DEMO_ENTRIES.map((entry) => entry.key));
    expect(Object.keys(DEMO_TRANSLATIONS).filter((key) => !keys.has(key))).toEqual([]);
    for (const entry of DEMO_ENTRIES) {
      const other = entryLanguage(entry) === "ar" ? "fr" : "ar";
      const text = DEMO_TRANSLATIONS[entry.key]?.[other];
      expect(text?.title.trim(), `${entry.key} ${other}`).toBeTruthy();
      expect(text?.description.trim(), `${entry.key} ${other}`).toBeTruthy();
      // Only the missing language: the original is the catalog's.
      expect(Object.keys(DEMO_TRANSLATIONS[entry.key] ?? {}), entry.key).toEqual([other]);
    }
  });

  it("write French without Arabic script and Arabic in Arabic script", () => {
    for (const entry of DEMO_ENTRIES) {
      const { fr, ar } = entryTexts(entry);
      expect(ARABIC.test(`${fr.title} ${fr.description}`), `${entry.key} fr`).toBe(false);
      expect(ARABIC.test(ar.title) && ARABIC.test(ar.description), `${entry.key} ar`).toBe(true);
    }
  });

  it("keep the moderation rules of the catalog", () => {
    for (const entry of DEMO_ENTRIES) {
      const sub = subcategoryById(entry.sub);
      for (const text of Object.values(entryTexts(entry))) {
        const result = containsProhibited(`${text.title}\n${text.description}`, undefined, { categoryId: sub?.categoryId });
        expect(sub?.adultsOnly ? result.hard : result.matches, entry.key).toEqual([]);
      }
    }
  });
});

describe("example listings in the page language", () => {
  const arabicIndex = DEMO_ENTRIES.findIndex((entry) => entry.key === "svc-henna");
  const frenchIndex = DEMO_ENTRIES.findIndex((entry) => entry.key === "car-tesla3");
  const arabicId = demoListingId(arabicIndex);
  const frenchId = demoListingId(frenchIndex);
  const henna = DEMO_ENTRIES[arabicIndex]!;
  const tesla = DEMO_ENTRIES[frenchIndex]!;

  function doc(id: string, title: string, isExample: boolean): CardDocument {
    return { id, slugId: `x-${id}`, title, subcategoryId: "beaute", price: 200, priceNegotiable: false, isDonation: false, citySlug: "marrakech", photoCount: 0, sellerType: "individual", sortAt: NOW.getTime(), isBumped: false, ...(isExample ? { isExample: true as const } : {}) } as CardDocument;
  }

  it("give an example card its title in each language", () => {
    const card = toSearchCard(doc(arabicId, henna.title, true), NOW);
    expect(shownTitle(card, "ar")).toBe(henna.title);
    expect(shownTitle(card, "fr")).toBe(DEMO_TRANSLATIONS["svc-henna"]?.fr?.title);
    expect(ARABIC.test(shownTitle(card, "fr"))).toBe(false);
    // Tarifit pages: the French text.
    expect(shownTitle(card, "rif")).toBe(shownTitle(card, "fr"));
    const french = toSearchCard(doc(frenchId, tesla.title, true), NOW);
    expect(shownTitle(french, "fr")).toBe(tesla.title);
    expect(ARABIC.test(shownTitle(french, "ar"))).toBe(true);
  });

  it("leave a member's listing in its author's language", () => {
    const member = toSearchCard(doc("abcd2345", "نقاشة الحناء", false), NOW);
    expect(member).not.toHaveProperty("titles");
    expect(shownTitle(member, "fr")).toBe("نقاشة الحناء");
    // Even with an example's id, a listing not marked example is a member's.
    expect(exampleTitlesField(arabicId, false)).toEqual({});
    const page = { id: arabicId, example: false, title: "Mon titre", description: "Ma description" };
    expect(localizeExample(page, "ar")).toBe(page);
  });

  it("show the listing page of an example in the page language", () => {
    const page = { id: arabicId, example: true, title: henna.title, description: henna.description, other: 1 };
    expect(localizeExample(page, "fr")).toEqual({ ...page, ...DEMO_TRANSLATIONS["svc-henna"]?.fr });
    expect(localizeExample(page, "rif")).toEqual(localizeExample(page, "fr"));
    expect(localizeExample(page, "ar")).toEqual(page);
  });

  it("index an example under both titles", () => {
    expect(exampleSearchTitles(arabicId)).toEqual([DEMO_TRANSLATIONS["svc-henna"]?.fr?.title, henna.title]);
    expect(exampleSearchTitles("abcd2345")).toEqual([]);
  });
});
