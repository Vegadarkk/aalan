import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import fr from "../../messages/fr.json";
import { Footer } from "@/components/legal/footer";
import {
  categorySections,
  DIRECTORY_LIST_CLASS,
  DIRECTORY_SECTION_CLASS,
  DIRECTORY_TITLE_CLASS,
  directoryHtml,
  regionSections,
  type DirectorySection,
} from "@/components/legal/footer-directory";
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

// Leboncoin's footer layout (owner, 2026-10-31): the plan of the categories and of the regions, then four columns.

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

/** The directory as it was written in JSX: what directoryHtml must reproduce byte for byte. */
function Twin({ sections }: { sections: readonly DirectorySection[] }) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.href} className={DIRECTORY_SECTION_CLASS}>
          <p className={DIRECTORY_TITLE_CLASS}>
            <a href={section.href}>{section.label}</a>
          </p>
          <ul className={DIRECTORY_LIST_CLASS}>
            {section.links.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

describe("Footer", () => {
  it("lists every category with its subcategories, and the regions with their main cities", () => {
    const html = render();
    expect(html).toContain(`aria-label="${fr.Footer.categoriesLabel}"`);
    expect(html).toMatch(/href="\/fr\/c\/vehicules"/);
    expect(html).toMatch(/href="\/fr\/recherche\?[^"]*location-vacances"/);
    expect(html).toContain(`aria-label="${fr.Footer.regionsLabel}"`);
    expect(html).toContain(">Casablanca</a>");
    expect(html).toContain(">Nador</a>");
  });

  it("keeps the legal, Pro and help columns", () => {
    const html = render();
    for (const label of [
      fr.Footer.legalTitle,
      fr.Footer.prosTitle,
      fr.Footer.questionsTitle,
      fr.Footer.contact,
      fr.Footer.links.mentions,
      fr.Footer.pricing,
      fr.Footer.wallet,
    ])
      expect(html).toContain(label);
    expect(html.match(/Mentions légales/g)).toHaveLength(1);
  });

  it("builds the directory exactly as React renders its JSX, in every language", async () => {
    for (const locale of ["fr", "ar", "rif"] as const) {
      const names = createTranslator({ locale, messages: await loadMessages(locale), namespace: "Categories" });
      const categories = categorySections(locale, (key) => names(key as never));
      const regions = regionSections(locale);
      expect(categories).toHaveLength(CATEGORIES.length);
      expect(regions).toHaveLength(REGIONS.length);
      expect(directoryHtml(categories)).toBe(renderToStaticMarkup(<Twin sections={categories} />));
      expect(directoryHtml(regions)).toBe(renderToStaticMarkup(<Twin sections={regions} />));
    }
    // Links are localized: the French and Arabic directories differ by their prefix and their labels.
    expect(directoryHtml(regionSections("ar"))).toContain('href="/ar/recherche?');
    expect(directoryHtml(regionSections("ar"))).toContain(">الدار البيضاء</a>");
  });

  it("escapes text and attributes as React does", () => {
    const sections: DirectorySection[] = [{ label: `Tom & Jerry <b>"quoted"</b> l'été`, href: "/x?a=1&b=<2>", links: [{ label: "A & B", href: "/y?c='3'" }] }];
    const html = directoryHtml(sections);
    expect(html).toBe(renderToStaticMarkup(<Twin sections={sections} />));
    expect(html).toContain("Tom &amp; Jerry &lt;b&gt;&quot;quoted&quot;&lt;/b&gt; l&#x27;été");
    expect(html).toContain('href="/x?a=1&amp;b=&lt;2&gt;"');
  });
});
