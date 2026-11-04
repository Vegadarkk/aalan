import { CATEGORIES } from "@/config/categories";
import { REGIONS, citiesOfRegion, cityName, regionName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { getPathname } from "@/i18n/navigation";
import { searchPath } from "@/lib/search/params";
import type { DirectoryLink, DirectorySection, FooterDirectoryData } from "./footer-directory-view";

// The footer's directory, built on the server from the config and the message catalogs (no user
// text): the category heads go in every page, the whole plan in the static JSON of
// /api/footer-directory/<locale> (footer-directory-view.tsx).

/** Cities listed under each region of the directory: its largest ones. */
export const CITIES_PER_REGION = 4;

/** The Categories namespace: "vehicules.name", "vehicules.sub.voitures". */
export type CategoryNames = (key: string) => string;

type Category = (typeof CATEGORIES)[number];

const head = (category: Category, locale: Locale, names: CategoryNames): DirectoryLink => ({
  label: names(`${category.id}.name`),
  href: getPathname({ href: `/c/${category.id}`, locale }),
});

/** Every category with its landing page (/c/..., the crawlable entry points). */
export function categoryHeads(locale: Locale, names: CategoryNames): DirectoryLink[] {
  return CATEGORIES.map((category) => head(category, locale, names));
}

/** Every category with its subcategories: the category page, then the subcategory searches. */
export function categorySections(locale: Locale, names: CategoryNames): DirectorySection[] {
  const localized = (href: string) => getPathname({ href, locale });
  return CATEGORIES.map((category) => ({
    ...head(category, locale, names),
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

/** The whole directory of a locale. */
export function footerDirectory(locale: Locale, names: CategoryNames): FooterDirectoryData {
  return { categories: categorySections(locale, names), regions: regionSections(locale) };
}
