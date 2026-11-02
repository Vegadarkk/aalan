import { CATEGORIES } from "@/config/categories";
import { REGIONS, citiesOfRegion, cityName, regionName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { getPathname } from "@/i18n/navigation";
import { searchPath } from "@/lib/search/params";

// The footer's directory (the plan of the categories and of the regions with their main cities:
// about 150 links on every page) as HTML built once per locale and process. As React elements,
// its ~450 nodes were serialized into the RSC payload and rendered to HTML again on every uncached
// page (profile of 2 Nov 2026, docs/lancement/charge.md); as one string they cost a copy. The
// markup is exactly what the JSX rendered (same elements, classes and escaping):
// tests/unit/footer.test.tsx renders the JSX twin and compares, in every language. Config and
// message catalogs only: no user text reaches this file.

/** Cities listed under each region of the directory: its largest ones. */
export const CITIES_PER_REGION = 4;

export const DIRECTORY_SECTION_CLASS = "mb-7 break-inside-avoid";
export const DIRECTORY_TITLE_CLASS = "mb-2 text-sm font-semibold tracking-wide uppercase";
export const DIRECTORY_LIST_CLASS = "flex flex-col gap-1.5 text-sm";

export interface DirectoryLink {
  label: string;
  href: string;
}

export interface DirectorySection extends DirectoryLink {
  links: DirectoryLink[];
}

/** The Categories namespace: "vehicules.name", "vehicules.sub.voitures". */
export type CategoryNames = (key: string) => string;

/** Every category with its subcategories: the category page, then the subcategory searches. */
export function categorySections(locale: Locale, names: CategoryNames): DirectorySection[] {
  const localized = (href: string) => getPathname({ href, locale });
  return CATEGORIES.map((category) => ({
    label: names(`${category.id}.name`),
    href: localized(`/c/${category.id}`),
    links: category.subcategories.map((sub) => ({
      label: names(`${category.id}.sub.${sub.id}`),
      href: localized(searchPath({ category: category.id, subcategory: sub.id })),
    })),
  }));
}

/** Every region with its largest cities: searches by region, then by city. */
export function regionSections(locale: Locale): DirectorySection[] {
  const localized = (href: string) => getPathname({ href, locale });
  return REGIONS.map((region) => ({
    label: regionName(region, locale),
    href: localized(searchPath({ region: region.code })),
    links: [...citiesOfRegion(region.code)]
      .sort((a, b) => b.population - a.population)
      .slice(0, CITIES_PER_REGION)
      .map((city) => ({ label: cityName(city, locale), href: localized(searchPath({ city: city.slug })) })),
  }));
}

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** React's escaping of text and attribute values (escapeTextForBrowser): the same five characters. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** The sections as the JSX twin renders them (tests/unit/footer.test.tsx). */
export function directoryHtml(sections: readonly DirectorySection[]): string {
  let html = "";
  for (const section of sections) {
    html += `<div class="${DIRECTORY_SECTION_CLASS}"><p class="${DIRECTORY_TITLE_CLASS}"><a href="${escapeHtml(section.href)}">${escapeHtml(section.label)}</a></p><ul class="${DIRECTORY_LIST_CLASS}">`;
    for (const link of section.links) html += `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`;
    html += "</ul></div>";
  }
  return html;
}

export interface DirectoryHtml {
  categories: string;
  regions: string;
}

const built = new Map<Locale, DirectoryHtml>();

/** The directory of a locale, built on first use (the catalogs and the config are static). */
export function footerDirectory(locale: Locale, names: CategoryNames): DirectoryHtml {
  let html = built.get(locale);
  if (!html) {
    html = { categories: directoryHtml(categorySections(locale, names)), regions: directoryHtml(regionSections(locale)) };
    built.set(locale, html);
  }
  return html;
}
