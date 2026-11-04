import { getTranslations } from "next-intl/server";
import type { Locale } from "@/config/site";
import { factKey } from "@/lib/listings/card-facts";
import type { MapListingLabels } from "./map-listings";
import { getNumbersTranslations } from "@/i18n/numbers-server";

// The words of the map listings (Carte vivante, lots 2 and 3), translated on the server for the
// search page and the home page: prices, units and key facts as the results card prints them.

export async function mapListingLabels(locale: Locale): Promise<MapListingLabels> {
  const [own, card, units] = await Promise.all([
    getTranslations({ locale, namespace: "SearchMap" }),
    // Prices print numbers: Tarifit pages format them as French (no Intl data for "rif").
    getNumbersTranslations({ locale, namespace: "ListingCard" }),
    getTranslations({ locale, namespace: "SearchMap.pin.per" }),
  ]);
  return {
    donation: card("donation"),
    toDiscuss: card("toDiscuss"),
    salaryToDiscuss: card("salaryToDiscuss"),
    today: own("today"),
    per: (unit) => card(`per.${unit}`),
    pinPer: (unit) => units(unit),
    fact: (id, value) => {
      const key = factKey({ id, value }) as "facts.surface";
      return card.has(key) ? card(key, { count: value as number, text: String(value) }) : null;
    },
  };
}
