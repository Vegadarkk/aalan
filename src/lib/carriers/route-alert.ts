import { DEPARTURE_SUBCATEGORY } from "@/config/categories";
import type { SearchParams } from "@/lib/search/params";
import type { CarrierSearchParams } from "./search-params";

// Route alerts of /transporteurs (transporteurs/spec.md §5): « Préviens-moi du prochain départ
// Lille → Oujda » is a saved search of the departures subcategory, its direction criterion and its
// route (search/params.ts `route`), alerted by the daily saved-search digest like any other.
// Period, basket and order are not part of it: a new departure on the route is what counts.

const DIRECTION_OPTION = { eu_ma: "europe-maroc", ma_eu: "maroc-europe" } as const;

export function routeAlertParams(query: Pick<CarrierSearchParams, "direction" | "country" | "zone" | "city">): SearchParams {
  const route = {
    ...(query.zone ? { zone: query.zone } : query.country ? { country: query.country } : {}),
    ...(query.city ? { city: query.city } : {}),
  };
  return {
    category: "services",
    subcategory: DEPARTURE_SUBCATEGORY,
    criteria: { "departure-direction": { kind: "options", values: [DIRECTION_OPTION[query.direction]] } },
    ...(Object.keys(route).length ? { route } : {}),
  };
}
