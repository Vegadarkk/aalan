import type { AbstractIntlMessages } from "next-intl";

// Messages the browser receives (NextIntlClientProvider). Server components translate on the server
// and need none of it; a client island reads its namespaces from the nearest provider. The public
// layout ships the namespaces of its own islands (header, footer, consent, error boundary) and each
// public page provides what its islands read, in a nested provider that replaces, never merges
// (src/components/i18n/page-messages.tsx). A namespace both name travels once: React Server
// Components serialize an object once and reference it afterwards. The lists are kept exact by
// tests/unit/client-messages.test.ts, which walks the client modules of every public route.

/** Namespaces read by the client islands of the public layout: header, footer, consent, error boundary, toasts. */
export const LAYOUT_CLIENT_NAMESPACES = [
  "Nav",
  "Locale",
  "Theme",
  "Error",
  "Toaster",
  // Cookie consent: banner, panel and the footer's "Gérer mes cookies".
  "Consent",
  // CGU change notice under the header (signed-in members, D11).
  "CguNotice",
  // The header's account menu and its dropdown.
  "Auth.menu",
  "Auth.settings",
  // The Assistant Aalan bubble at the bottom end of every public page (owner, 2026-10-30); its panel
  // loads on demand, with the shared form messages (Turnstile, API errors).
  "Help.assistant",
  "Auth.common",
  "Auth.errors",
  "Listing.errors",
  // The header's search pill: the place field.
  "Search.location",
] as const;

/** The listing page (annonce/[slugId]). */
export const LISTING_PAGE_CLIENT_NAMESPACES = [
  // Gallery, map, contact (the reveal errors and challenge load on demand), catalogue, promo.
  "ListingPage.gallery",
  "ListingPage.contact",
  "ListingPage.catalogue",
  "ListingPage.promo",
  // "Salaire mensuel brut" above a job offer's amount (ListingPrice is a client island).
  "ListingPage.salary",
  // "Partager" beside the favourite button (UX journeys counter-review, 8).
  "ListingPage.share",
  "Map",
  // Favourite heart, price tag and promo badge, « Masquer les annonces exemples ».
  "Favorites.button",
  "ListingCard",
  "Examples",
  // Form messages (Turnstile, API errors) of the contact, offer and favourite islands.
  "Auth.common",
  "Auth.errors",
  "Listing.errors",
  // Report button; its dialog loads on demand (phase 5).
  "Report",
  // « Payer chez le vendeur » button and dialog of a Pro's listing (phase 7).
  "SellerPayment.public",
  // « Faire une offre »: the button, the amount and the first-message dialog (Carte vivante lot 5).
  "Offers.listing",
  "Offers.field",
  "Offers.dialog",
  "Offers.errors",
  // Car rental availability block and its date fields (rental pack §3).
  "Rental.listing",
  "Rental.calendar",
  "Rental.search",
  // The ad slots' consent panel.
  "Consent",
] as const;

/** The category landings (c/[category]/...): result cards and the example notice. */
export const CATEGORY_PAGE_CLIENT_NAMESPACES = [
  "Favorites.button",
  "ListingCard",
  "Examples",
  // Form messages (API errors) of the favourite button.
  "Auth.common",
  "Auth.errors",
  "Listing.errors",
] as const;

/** A Pro's storefront (boutique/[shop]). */
export const STOREFRONT_PAGE_CLIENT_NAMESPACES = [
  "Favorites.button",
  "ListingCard",
  "Examples",
  "Auth.common",
  "Auth.errors",
  "Listing.errors",
  "Report",
  // « Partager » in the storefront's header (UX audit of the Pro shops, B2).
  "ListingPage.share",
  // « Ouvert jusqu'à… » of its practical information (UX audit lot 1).
  "Storefront.info",
  // « Envoyer un message » and the number of the shop itself, without a listing (UX audit lot 1).
  "ListingPage.contact",
  "Offers.listing",
  "Offers.field",
  "Offers.dialog",
  "Offers.errors",
  // « Payer chez le vendeur » of a Pro's storefront (phase 7).
  "SellerPayment.public",
  // Fleet of a car rental agency's storefront, filtered by dates in place (rental pack §5).
  "Storefront.fleet",
  "Rental.search",
  "Rental.calendar",
  // The ad slots' consent panel.
  "Consent",
] as const;

/** A member's public profile (profil/[publicId]). */
export const PROFILE_PAGE_CLIENT_NAMESPACES = ["Favorites.button", "ListingCard", "Auth.common", "Auth.errors", "Listing.errors", "Report", "Consent"] as const;

/** The guide's home (demarches): its search box. */
export const GUIDE_PAGE_CLIENT_NAMESPACES = ["Guide.search"] as const;

/**
 * The home page: result cards, the search bar, the living map (Carte vivante, lot 3, sharing the
 * search page's map islands), the « Louer une voiture » module (rental pack §4) and the panel's
 * legal line (cookies, language, theme).
 */
export const HOME_PAGE_CLIENT_NAMESPACES = [
  "Favorites.button",
  "ListingCard",
  "Examples",
  "Auth.common",
  "Auth.errors",
  "Listing.errors",
  "Search.bar",
  "Search.location",
  "Map",
  "SearchMap",
  "Rental.home",
  "Rental.search",
  "Rental.calendar",
  "Consent",
  "Locale",
  "Theme",
] as const;

/**
 * The search page: the filters sheet reads the criteria and category labels (~30 KB), which no
 * other public page needs; the map view (Carte vivante, lot 2); the saved searches; the understood
 * words of a typed sentence and « Utiliser ma position » (lot 4).
 */
export const SEARCH_PAGE_CLIENT_NAMESPACES = [
  "Favorites.button",
  "ListingCard",
  "Examples",
  "Auth.common",
  "Auth.errors",
  "Listing.errors",
  "Search.bar",
  "Search.location",
  "Map",
  "SearchMap",
  "SearchFilters",
  "SearchPage",
  "Criteria",
  "Categories",
  "Listing.units",
  "Listing.wizard",
  "Listing.fields",
  "SavedSearches.button",
  "SavedSearches.summary",
  "SavedSearches.dialog",
  "SearchInterpret",
  "Rental.search",
  "Rental.calendar",
  "Consent",
  "Locale",
  "Theme",
] as const;

/**
 * The help centre (src/app/[locale]/(public)/aide/layout.tsx): the article search box and the
 * Assistant Joutiya widget (design phase-5 D25), and the contact page's "Signaler un contenu
 * illicite" form (DSA art. 16) with the report dialog.
 */
export const HELP_PAGE_CLIENT_NAMESPACES = ["Help.search", "Help.assistant", "Contact.report", "Report", "Auth.common", "Auth.errors", "Listing.errors"] as const;

/** The subtrees of `messages` named by `paths` ("Auth.menu" keeps `{ Auth: { menu } }`); unknown paths are skipped. */
export function pickMessages(messages: AbstractIntlMessages, paths: readonly string[]): AbstractIntlMessages {
  const out: AbstractIntlMessages = {};
  for (const path of paths) {
    const keys = path.split(".");
    let source: AbstractIntlMessages | string | undefined = messages;
    for (const key of keys) source = typeof source === "object" ? source[key] : undefined;
    if (source === undefined) continue;
    let target = out;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) {
        target[key] = source;
        return;
      }
      const next = target[key];
      target = (target[key] = typeof next === "object" ? next : {}) as AbstractIntlMessages;
    });
  }
  return out;
}
