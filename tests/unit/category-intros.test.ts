import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/config/categories";
import { CATEGORY_INTRO_IDS, categoryIntro } from "@/content/seo/category-intros";

// Editorial block of the top-level category pages (SEO audit T1): real categories only, both
// indexed languages, unique copy, no link or phone number in a text.

describe("category intros", () => {
  it("covers real top-level categories in French and Arabic, Tarifit falling back to French", () => {
    const ids = new Set(CATEGORIES.map((category) => category.id));
    for (const id of CATEGORY_INTRO_IDS) {
      expect(ids.has(id), id).toBe(true);
      expect(categoryIntro("ar", id), id).not.toBeNull();
      expect(categoryIntro("rif", id)).toEqual(categoryIntro("fr", id));
    }
    expect(categoryIntro("fr", "divers")).toBeNull();
    expect(categoryIntro("fr", "constructor")).toBeNull();
  });

  it("keeps every text unique, sized for a landing page and free of links", () => {
    for (const locale of ["fr", "ar"] as const) {
      const texts = CATEGORY_INTRO_IDS.map((id) => categoryIntro(locale, id)!);
      const all = texts.flatMap((text) => [text.intro, ...text.faq.flatMap((item) => [item.q, item.a])]);
      expect(new Set(all).size).toBe(all.length);
      for (const text of texts) {
        expect(text.intro.split(/\s+/).length).toBeGreaterThanOrEqual(40);
        expect(text.faq.length).toBeGreaterThanOrEqual(2);
      }
      for (const value of all) expect(value).not.toMatch(/https?:|www\.|\+212|\b0[5-7]\d{8}\b/);
    }
  });
});
