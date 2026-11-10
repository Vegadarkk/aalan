import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarrierShop } from "@/lib/carriers/directory";

// Carriers space, lot 3 (transporteurs/spec.md §5): a departure's index fields, the query string of
// /transporteurs, the engine filter, and the search itself on the memory engine: departures joined
// to their carrier, priced from the basket, sorted, with the route's price guide.

const shops = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock("@/lib/carriers/directory", () => ({ carrierShops: vi.fn(async () => shops.map) }));

import { DEPARTURE_SUBCATEGORY } from "@/config/categories";
import { departureFilter, searchDepartures, searchPeriod } from "@/lib/carriers/search";
import { basketOf, carrierSearchPath, parseCarrierSearch, type CarrierSearchParams } from "@/lib/carriers/search-params";
import type { ListingRecord } from "@/lib/db/repositories/listings";
import { dayNumber } from "@/lib/listings/rental-availability";
import type { CarrierSettings } from "@/lib/pro/profile-schema";
import { toSearchDocument } from "@/lib/search/document";
import { setSearchEngineForTests } from "@/lib/search/engine";
import { MemoryEngine } from "@/lib/search/memory";

const NOW = new Date("2026-11-10T10:00:00.000Z");

function departureListing(id: string, seller: string, patch: Partial<NonNullable<ListingRecord["departure"]>> = {}): ListingRecord {
  return {
    id,
    ownerUid: `owner-${seller}`,
    proId: `pro-${seller}`,
    sellerType: "pro",
    sellerName: seller,
    sellerPublicId: seller,
    status: "published",
    slugId: `depart-${id}`,
    title: "Rhône +1 → Nador · départ le 20/11/2026",
    description: "Départ Europe → Maroc le 20/11/2026.",
    categoryId: "services",
    subcategoryId: DEPARTURE_SUBCATEGORY,
    attributes: { "departure-direction": patch.direction === "ma_eu" ? "maroc-europe" : "europe-maroc" },
    price: null,
    priceNegotiable: false,
    isDonation: false,
    location: { regionCode: "02", citySlug: "nador", geo: { lat: 35.17, lng: -2.93 } },
    photos: [],
    contact: { messaging: true, showPhone: false, whatsapp: false },
    boosts: {},
    sortAt: NOW,
    sortSource: "publish",
    moderation: { state: "auto_ok", score: 0, flags: [], openReports: 0 },
    adsEligible: false,
    publishedAt: NOW,
    expiresAt: new Date("2026-11-21T00:00:00.000Z"),
    legalHold: [],
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    departure: {
      direction: "eu_ma",
      departOn: "2026-11-20",
      depositBy: "2026-11-19",
      arriveFrom: "2026-11-22",
      arriveTo: "2026-11-24",
      euZones: ["FR-69", "FR-38"],
      maCities: ["nador", "oujda"],
      space: "some",
      spaceKg: 300,
      spaceUpdatedAt: NOW,
      ...patch,
    },
  } as ListingRecord;
}

function carrier(name: string, perKg: number, extra: Partial<CarrierSettings["tariff"]> = {}, rating: CarrierShop["rating"] = null): CarrierShop {
  return {
    proId: `pro-${name}`,
    segment: `${name}-pro`,
    name,
    verified: true,
    rating,
    carrierUpdatedAt: NOW.getTime(),
    carrier: {
      licenceRef: "2024/069/0001234",
      directions: ["eu_ma"],
      euZones: ["FR-69", "FR-38"],
      maCities: ["nador", "oujda"],
      pickup: { depot: true, home: false },
      delivery: { depot: false, home: true },
      vehicle: { kind: "van", volumeM3: 20, payloadKg: 1200 },
      transitDays: { min: 2, max: 4 },
      tariff: { currency: "EUR", perKg, bands: [], minimum: 0, volumetricKgPerM3: null, items: [], surcharges: [], ...extra },
      refused: [],
      note: "",
    },
  };
}

const params = (patch: Partial<CarrierSearchParams> = {}): CarrierSearchParams => ({ direction: "eu_ma", sort: "date", ...patch });

describe("a departure in the index", () => {
  it("carries its day, places, room and card, and its places are searchable words", () => {
    const doc = toSearchDocument(departureListing("abcdefgh", "seller1"), NOW)!;
    expect(doc).toMatchObject({ depOn: dayNumber("2026-11-20"), depZones: ["FR-69", "FR-38"], depCountries: ["FR"], depCities: ["nador", "oujda"], depSpace: "some" });
    expect(doc.departure).toEqual(expect.objectContaining({ departOn: "2026-11-20", spaceKg: 300, spaceUpdatedAt: NOW.getTime() }));
    expect(doc.attrsText).toContain("Isère");
    expect(doc.attrsText).toContain("Oujda");
  });
});

describe("the query string", () => {
  it("reads a search and writes it back, dropping what is unknown or out of bounds", () => {
    const parsed = parseCarrierSearch(new URLSearchParams("sens=maroc-europe&zone=FR-69&ville=nador&du=2026-11-15&au=2026-11-01&kg=40&objets=suitcase.2,e-scooter.1,rocket.3,box-m.99&collecte=1&tri=prix"));
    expect(parsed).toEqual({ direction: "ma_eu", country: "FR", zone: "FR-69", city: "nador", from: "2026-11-15", kg: 40, items: { suitcase: 2, "e-scooter": 1 }, pickup: true, sort: "price" });
    expect(carrierSearchPath(parsed)).toBe("/transporteurs?sens=maroc-europe&zone=FR-69&ville=nador&du=2026-11-15&kg=40&objets=suitcase.2%2Ce-scooter.1&collecte=1&tri=prix");
    expect(parseCarrierSearch({ pays: "XX", ville: "atlantis", kg: "0", tri: "?" })).toEqual({ direction: "eu_ma", sort: "date" });
    expect(carrierSearchPath(params())).toBe("/transporteurs");
    expect(basketOf(params())).toBeNull();
    expect(basketOf(params({ items: { suitcase: 1 } }))).toEqual({ kg: 0, items: { suitcase: 1 }, options: { pickup: false, delivery: false } });
  });

  it("searches from today, 60 days by default, never in the past", () => {
    expect(searchPeriod({}, NOW)).toEqual({ from: "2026-11-10", to: "2027-01-09" });
    expect(searchPeriod({ from: "2026-10-01", to: "2026-11-30" }, NOW)).toEqual({ from: "2026-11-10", to: "2026-11-30" });
    const filter = JSON.stringify(departureFilter(params({ country: "BE", city: "oujda" }), NOW));
    expect(filter).toContain('"depCountries","op":"eq","value":"BE"');
    expect(filter).toContain('"not":{"field":"depSpace","op":"eq","value":"full"}');
    expect(JSON.stringify(departureFilter(params({ full: true }), NOW))).not.toContain("depSpace");
  });
});

describe("searchDepartures", () => {
  let engine: MemoryEngine;
  beforeEach(async () => {
    engine = new MemoryEngine();
    setSearchEngineForTests(engine);
    await engine.upsert([
      toSearchDocument(departureListing("aaaaaaaa", "atlas", { departOn: "2026-11-20" }), NOW)!,
      toSearchDocument(departureListing("bbbbbbbb", "rif", { departOn: "2026-11-18", depositBy: "2026-11-17", maCities: ["oujda"] }), NOW)!,
      toSearchDocument(departureListing("cccccccc", "souss", { departOn: "2026-11-25", depositBy: "2026-11-24", arriveFrom: "2026-11-27", arriveTo: "2026-11-29", space: "full", spaceKg: undefined }), NOW)!,
      toSearchDocument(departureListing("dddddddd", "hidden", { departOn: "2026-11-22", depositBy: "2026-11-21", arriveFrom: "2026-11-24", arriveTo: "2026-11-26" }), NOW)!,
      toSearchDocument(departureListing("eeeeeeee", "atlas", { direction: "ma_eu" }), NOW)!,
    ]);
    shops.map = new Map<string, CarrierShop>([
      ["atlas", carrier("atlas", 250, { items: [{ item: "e-scooter", price: 6000 }] }, { avg: 4.2, count: 10 })],
      ["rif", carrier("rif", 200, {}, { avg: 4.8, count: 3 })],
      ["souss", carrier("souss", 180)],
    ]);
  });
  afterEach(() => setSearchEngineForTests(null));

  it("finds the route's departures with room, joined to a shown carrier, by date", async () => {
    const found = await searchDepartures(params(), NOW);
    // « hidden » has no shown shop; « souss » is full; the Morocco → Europe one is the other way.
    expect(found.departures.map((card) => card.id)).toEqual(["bbbbbbbb", "aaaaaaaa"]);
    expect(found.departures[0]!.carrier).toMatchObject({ name: "rif", from: { perKg: 200, currency: "EUR" }, rating: { avg: 4.8, count: 3 } });
    expect(found.departures[0]!.estimate).toBeNull();
    expect((await searchDepartures(params({ full: true }), NOW)).departures.map((card) => card.id)).toEqual(["bbbbbbbb", "aaaaaaaa", "cccccccc"]);
    expect((await searchDepartures(params({ city: "nador" }), NOW)).departures.map((card) => card.id)).toEqual(["aaaaaaaa"]);
    expect((await searchDepartures(params({ to: "2026-11-19" }), NOW)).departures.map((card) => card.id)).toEqual(["bbbbbbbb"]);
    expect((await searchDepartures(params({ zone: "FR-75" }), NOW)).departures).toEqual([]);
  });

  it("prices the basket with each carrier's list and sorts by price or rating", async () => {
    const basket = { kg: 20, items: { "e-scooter": 1 } };
    const byPrice = await searchDepartures(params({ ...basket, sort: "price", full: true }), NOW);
    // atlas: 20 kg × 2,50 + scooter 60 = 110 €; rif: 20 × 2,00 = 40 € + scooter on request; souss: 20 × 1,80 = 36 €.
    expect(byPrice.departures.map((card) => [card.carrier.name, card.estimate?.total])).toEqual([
      ["souss", 3600],
      ["rif", 4000],
      ["atlas", 11000],
    ]);
    expect(byPrice.departures[1]!.estimate?.onRequest).toEqual(["e-scooter"]);
    const byRating = await searchDepartures(params({ sort: "rating" }), NOW);
    expect(byRating.departures.map((card) => card.carrier.name)).toEqual(["rif", "atlas"]);
    expect(byPrice.guide).toBeNull();
  });

  it("shows the route's price guide from five carriers on", async () => {
    const extra = ["fes", "meknes"].map((seller, index) => toSearchDocument(departureListing(`ffffff${index}a`, seller), NOW)!);
    await engine.upsert(extra);
    shops.map.set("fes", carrier("fes", 300));
    shops.map.set("meknes", carrier("meknes", 220));
    shops.map.set("hidden", carrier("hidden", 260));
    const found = await searchDepartures(params({ full: true }), NOW);
    expect(found.guide).toEqual({ currency: "EUR", min: 180, max: 300, carriers: 6 });
  });
});
