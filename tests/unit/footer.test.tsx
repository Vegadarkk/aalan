import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import fr from "../../messages/fr.json";
import { Footer } from "@/components/legal/footer";
import { categoryHeads, footerDirectory } from "@/components/legal/footer-directory";
import { footerDirectoryUrl } from "@/components/legal/footer-directory-view";
import { CATEGORIES } from "@/config/categories";
import { REGIONS } from "@/config/regions";
import { loadMessages } from "@/i18n/messages";

// Client widgets with their own tests.
vi.mock("@/components/layout/theme-toggle", () => ({
  ThemeToggle: () => null,
}));
vi.mock("@/components/layout/locale-switcher", () => ({
  LocaleSwitcher: () => null,
}));
vi.mock("@/components/consent/consent-link", () => ({
  ConsentLink: () => null,
}));
// The route handler translates with the catalogs of the requested locale.
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: "fr" | "ar" | "rif"; namespace: string }) =>
    createTranslator({ locale, messages: await loadMessages(locale), namespace: namespace as never }),
}));

// Leboncoin's footer layout (owner, 2026-10-31): the plan of the categories and of the regions, then
// four columns. The page carries the category heads only; the whole plan is a static JSON loaded
// when the band is about to show (audit zone 8, perf 6).

const render = () =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale="fr"
      messages={fr}
      timeZone="Africa/Casablanca"
    >
      <Footer publisher="Adark Prime" />
    </NextIntlClientProvider>,
  );

const names = async (locale: "fr" | "ar" | "rif") => {
  const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "Categories" });
  return (key: string) => t(key as never);
};

describe("Footer", () => {
  it("renders the category landing pages in a fold, without the ~150 search links", () => {
    const html = render();
    expect(html).toMatch(/<details class="[^"]*fold-open-md/);
    expect(html).toContain(`<summary`);
    expect(html).toContain(fr.Footer.directoryToggle);
    expect(html).toContain(`aria-label="${fr.Footer.categoriesLabel}"`);
    expect(html).toContain('href="/fr/c/vehicules"');
    for (const category of CATEGORIES) expect(html).toContain(`href="/fr/c/${category.id}"`);
    // Subcategory and place searches (robots.txt disallows /recherche) come with the JSON.
    expect(html).not.toContain("/fr/recherche?");
    expect(html).not.toContain(`aria-label="${fr.Footer.regionsLabel}"`);
  });

  it("keeps the legal, Pro and help columns", () => {
    const html = render();
    for (const label of [
      fr.Footer.legalTitle,
      fr.Footer.prosTitle,
      fr.Footer.questionsTitle,
      fr.Footer.contact,
      fr.Footer.links.cgv,
      fr.Footer.links.mentions,
      fr.Footer.pricing,
      fr.Footer.wallet,
    ])
      expect(html).toContain(label);
    expect(html.match(/Mentions légales/g)).toHaveLength(1);
  });

  it("builds the whole directory of every language: categories with subcategories, regions with cities", async () => {
    for (const locale of ["fr", "ar", "rif"] as const) {
      const directory = footerDirectory(locale, await names(locale));
      expect(directory.categories).toHaveLength(CATEGORIES.length);
      expect(directory.regions).toHaveLength(REGIONS.length);
      expect(directory.categories.map(({ label, href }) => ({ label, href }))).toEqual(categoryHeads(locale, await names(locale)));
      for (const region of directory.regions) expect(region.links.length).toBeGreaterThan(0);
    }
    const french = footerDirectory("fr", await names("fr"));
    expect(french.categories.flatMap((section) => section.links).some((link) => /^\/fr\/recherche\?.*location-vacances/.test(link.href))).toBe(true);
    const frenchCities = french.regions.flatMap((section) => section.links.map((link) => link.label));
    expect(frenchCities).toEqual(expect.arrayContaining(["Casablanca", "Nador"]));
    // Links are localized: the Arabic directory has its prefix and its labels.
    const arabic = footerDirectory("ar", await names("ar"));
    expect(arabic.regions[0]!.href).toMatch(/^\/ar\/recherche\?/);
    expect(arabic.regions.flatMap((section) => section.links.map((link) => link.label))).toContain("الدار البيضاء");
  });

  it("serves the directory as a static, cacheable JSON per locale", async () => {
    const route = await import("@/app/api/footer-directory/[locale]/route");
    expect(route.dynamicParams).toBe(false);
    expect(route.generateStaticParams().map((params) => params.locale)).toEqual(["fr", "ar", "rif"]);
    const response = await route.GET(new Request(`http://localhost${footerDirectoryUrl("ar")}`), { params: Promise.resolve({ locale: "ar" }) });
    expect(response.headers.get("cache-control")).toMatch(/public, max-age=\d+/);
    expect(await response.json()).toEqual(footerDirectory("ar", await names("ar")));
  });
});
