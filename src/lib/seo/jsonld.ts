// schema.org structured data of the landing pages (design D15). Pure. BreadcrumbList only: Google
// shows no rich result for an ItemList of listings. Serialized by `JsonLd` (serializeJsonLd escapes
// it for the inline data block).

export interface BreadcrumbStep {
  name: string;
  /** Absolute URL; Google allows the last step (the current page) without one. */
  url?: string;
}

/** BreadcrumbList with 1-based positions; null with fewer than two steps (Google needs two). */
export function breadcrumbJsonLd(
  steps: readonly BreadcrumbStep[],
): Record<string, unknown> | null {
  if (steps.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: steps.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      ...(step.url ? { item: step.url } : {}),
    })),
  };
}

// Storefront of a Pro shop (UX audit of the Pro shops, lot 3): a LocalBusiness of the sector's
// type with what the page shows. No phone (behind the reveal), no e-mail; the street address only
// when the shop gave one; the rating from the site's verified reviews.

const SHOP_TYPES = {
  general: "Store",
  dealer: "AutoDealer",
  real_estate: "RealEstateAgent",
  car_rental: "AutoRental",
  holiday_rental: "LodgingBusiness",
  carrier: "LocalBusiness",
} as const;

const DAY_NAMES = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
} as const;

export interface StorefrontJsonLdInput {
  name: string;
  sector: keyof typeof SHOP_TYPES;
  /** Absolute canonical URL of the page. */
  url: string;
  description: string;
  /** Localized city name; "" when unknown. */
  cityName: string;
  address: string;
  hours: {
    days: {
      day: keyof typeof DAY_NAMES;
      slots: { from: string; to: string }[];
    }[];
  } | null;
  website: string | null;
  sameAs: string[];
  rating: { count: number; average: number | null };
}

export function storefrontJsonLd(
  input: StorefrontJsonLdInput,
): Record<string, unknown> {
  const description = input.description.trim();
  const hours =
    input.hours?.days.flatMap((day) =>
      day.slots.map((slot) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${DAY_NAMES[day.day]}`,
        opens: slot.from,
        closes: slot.to,
      })),
    ) ?? [];
  const sameAs = [...(input.website ? [input.website] : []), ...input.sameAs];
  return {
    "@context": "https://schema.org",
    "@type": SHOP_TYPES[input.sector],
    "@id": `${input.url}#shop`,
    name: input.name,
    url: input.url,
    ...(description
      ? {
          description:
            description.length > 1000
              ? `${description.slice(0, 999)}…`
              : description,
        }
      : {}),
    address: {
      "@type": "PostalAddress",
      ...(input.address.trim() ? { streetAddress: input.address.trim() } : {}),
      ...(input.cityName ? { addressLocality: input.cityName } : {}),
      addressCountry: "MA",
    },
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(input.rating.count > 0 && input.rating.average !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.rating.average,
            reviewCount: input.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

// The site itself on the home page (audit zone 2, P3-2): a WebSite with its search box
// (SearchAction on /recherche?q=) and the Organization behind the brand, linked in one graph.
// URLs come from the canonical origin, like the canonical links, so they follow the domain switch.

export interface SiteJsonLdInput {
  /** Canonical origin, e.g. https://aalan.ma (no trailing slash). */
  origin: string;
  /** Locale prefix of the page, e.g. "fr". */
  locale: string;
  /** BCP 47 tag of the page language, e.g. "fr-MA". */
  inLanguage: string;
  name: string;
  /** Other spellings of the brand (Arabic, Tifinagh). */
  alternateNames: readonly string[];
  description: string;
  /** Path of the search page, without the locale prefix. */
  searchPath: string;
}

export function siteJsonLd(input: SiteJsonLdInput): Record<string, unknown> {
  const origin = input.origin.replace(/\/+$/, "");
  const home = `${origin}/${input.locale}`;
  const organization = `${origin}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: input.name,
        alternateName: [...input.alternateNames],
        description: input.description,
        inLanguage: input.inLanguage,
        publisher: { "@id": organization },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${home}${input.searchPath}?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": organization,
        name: input.name,
        alternateName: [...input.alternateNames],
        url: origin,
        logo: `${origin}/brand/icon-512.png`,
      },
    ],
  };
}
