import { describe, expect, it } from "vitest";
import { CARRIER_ITEMS, CARRIER_LICENCE_PATTERN, EU_ZONE_LIST, euZoneById, isEuZone } from "@/config/carriers";
import { estimate, ratePerKg } from "@/lib/carriers/estimate";
import { carrierSchema, carrierTariffSchema, type CarrierTariff } from "@/lib/pro/profile-schema";

// Carriers space, lot 1b (transporteurs/spec.md §3 and §5): the settings' schema, the EU zones and
// the price estimate of a client's shipment from a carrier's price list.

const TARIFF: CarrierTariff = {
  currency: "EUR",
  perKg: 250,
  bands: [
    { fromKg: 60, perKg: 200 },
    { fromKg: 150, perKg: 180 },
  ],
  minimum: 2000,
  volumetricKgPerM3: 250,
  items: [
    { item: "e-scooter", price: 6000 },
    { item: "tv-large", price: 8000 },
  ],
  surcharges: [
    { kind: "pickup", value: 1000 },
    { kind: "fragile", value: 500 },
    { kind: "peak", value: 10 },
    { kind: "insurance", value: 2 },
  ],
};

const SETTINGS = {
  licenceRef: "LC 2024/069 001234",
  directions: ["eu_ma"],
  euZones: ["FR-69", "BE-BRU"],
  maCities: ["agadir"],
  pickup: { depot: true, home: false },
  delivery: { depot: false, home: true },
  vehicle: { kind: "van", volumeM3: 20, payloadKg: 1200 },
  transitDays: { min: 3, max: 5 },
  tariff: TARIFF,
  refused: ["lithium-battery"],
  note: "",
};

describe("carrier settings", () => {
  it("accepts a complete carrier and trims its licence reference", () => {
    const parsed = carrierSchema.parse({ ...SETTINGS, licenceRef: "  LC 2024/069 001234  " });
    expect(parsed.licenceRef).toBe("LC 2024/069 001234");
  });

  it("asks a licence reference with a digit, a pickup and a delivery mode, and known zones", () => {
    expect(CARRIER_LICENCE_PATTERN.test("LICENCE")).toBe(false);
    expect(carrierSchema.safeParse({ ...SETTINGS, licenceRef: "" }).success).toBe(false);
    expect(carrierSchema.safeParse({ ...SETTINGS, pickup: { depot: false, home: false } }).success).toBe(false);
    expect(carrierSchema.safeParse({ ...SETTINGS, euZones: ["FR-99"] }).success).toBe(false);
    expect(carrierSchema.safeParse({ ...SETTINGS, euZones: ["FR-69", "FR-69"] }).success).toBe(false);
    expect(carrierSchema.safeParse({ ...SETTINGS, directions: [] }).success).toBe(false);
    expect(carrierSchema.safeParse({ ...SETTINGS, transitDays: { min: 6, max: 3 } }).success).toBe(false);
  });

  it("refuses a priced item it also refuses", () => {
    expect(carrierSchema.safeParse({ ...SETTINGS, refused: ["e-scooter"] }).success).toBe(false);
  });

  it("bounds the price list by its currency", () => {
    expect(carrierTariffSchema.safeParse(TARIFF).success).toBe(true);
    expect(carrierTariffSchema.safeParse({ ...TARIFF, perKg: 20_000 }).success).toBe(false);
    expect(carrierTariffSchema.safeParse({ ...TARIFF, currency: "MAD", perKg: 20_000 }).success).toBe(true);
    expect(carrierTariffSchema.safeParse({ ...TARIFF, bands: [...TARIFF.bands].reverse() }).success).toBe(false);
    expect(carrierTariffSchema.safeParse({ ...TARIFF, surcharges: [{ kind: "peak", value: 150 }] }).success).toBe(false);
    expect(carrierTariffSchema.safeParse({ ...TARIFF, items: [...TARIFF.items, { item: "e-scooter", price: 1 }] }).success).toBe(false);
  });

  it("lists the EU zones by id", () => {
    expect(euZoneById("FR-69")).toEqual({ id: "FR-69", country: "FR", name: "Rhône" });
    expect(isEuZone("BE-BRU")).toBe(true);
    expect(new Set(EU_ZONE_LIST.map((zone) => zone.id)).size).toBe(EU_ZONE_LIST.length);
  });
});

describe("estimate", () => {
  it("takes the rate of the highest weight band reached", () => {
    expect(ratePerKg(TARIFF, 10)).toBe(250);
    expect(ratePerKg(TARIFF, 60)).toBe(200);
    expect(ratePerKg(TARIFF, 400)).toBe(180);
  });

  it("charges the weight, items at their flat price, and items counted by their weight", () => {
    const result = estimate(TARIFF, { kg: 30, items: { "e-scooter": 1, suitcase: 2 } });
    // 30 kg loose + 2 × 23 kg suitcases = 76 kg at 2,00 €, plus the scooter's 60 €.
    expect(result.chargedKg).toBe(76);
    expect(result.perKg).toBe(200);
    expect(result.total).toBe(76 * 200 + 6000);
    expect(result.lines.map((line) => line.kind)).toEqual(["weight", "item"]);
  });

  it("charges the volumetric weight when it is higher, and the minimum", () => {
    expect(estimate(TARIFF, { kg: 20, m3: 0.2, items: {} }).chargedKg).toBe(50);
    const small = estimate(TARIFF, { kg: 3, items: {} });
    expect(small.total).toBe(2000);
    expect(small.lines.at(-1)).toMatchObject({ kind: "minimum", amount: 2000 - 750 });
  });

  it("leaves out an item the list neither prices nor weighs, and reports an option it does not price", () => {
    const result = estimate(TARIFF, { kg: 10, items: { motorbike: 1 }, options: { delivery: true } });
    expect(result.onRequest).toEqual(["motorbike"]);
    expect(result.unpricedOptions).toEqual(["delivery"]);
    expect(CARRIER_ITEMS.motorbike.kg).toBeNull();
  });

  it("adds the surcharges, the insurance on the declared value and the high season last", () => {
    const result = estimate(TARIFF, { kg: 40, items: {}, options: { pickup: true, fragile: true }, declaredValue: 50_000, peak: true });
    const before = 40 * 250 + 1000 + 500 + 1000;
    expect(result.total).toBe(before + Math.round(before / 10));
    expect(result.lines.at(-1)).toMatchObject({ kind: "surcharge", key: "peak" });
  });

  it("estimates nothing for an empty basket", () => {
    expect(estimate(TARIFF, { kg: 0, items: {}, peak: true }).total).toBe(0);
  });
});
