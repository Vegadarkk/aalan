import type { CarrierCurrency } from "@/config/carriers";
import type { Estimate } from "@/lib/carriers/estimate";
import type { CarrierSettings } from "@/lib/pro/profile-schema";
import type { SearchDeparture } from "@/lib/search/types";

// What /transporteurs shows (transporteurs/spec.md §5): the departures found, each with its
// carrier and, when the client filled a basket, the estimate from the carrier's price list.
// Client-safe: the results are server-rendered, the comparator reads the same objects.

/** A carrier as its departures' cards and the comparator show it (all public on its storefront). */
export interface CarrierSummary {
  publicId: string;
  name: string;
  /** /boutique/{segment}. */
  segment: string;
  logo?: string;
  verified: boolean;
  rating: { avg: number; count: number } | null;
  /** Lowest per-kg rate of the list (« dès 2,00 € le kg »). */
  from: { perKg: number; currency: CarrierCurrency };
  settings: CarrierSettings;
}

export interface DepartureCard {
  id: string;
  slugId: string;
  departure: SearchDeparture;
  carrier: CarrierSummary;
  /** Null without a basket. */
  estimate: Estimate | null;
}

/** « Prix constatés » of a route: the spread of the carriers' base per-kg rates (spec §5, neutral). */
export interface RouteGuide {
  currency: CarrierCurrency;
  min: number;
  max: number;
  carriers: number;
}

export interface CarrierSearchResponse {
  departures: DepartureCard[];
  /** Matches in the index (the cards are capped at CARRIER_SEARCH.hitsMax). */
  total: number;
  guide: RouteGuide | null;
}
