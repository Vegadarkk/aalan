import { describe, expect, it } from "vitest";
import { DEPARTURE_SUBCATEGORY, subcategoryById } from "@/config/categories";
import { DEPARTURE_LIMITS } from "@/config/carriers";
import { cityBySlug } from "@/config/regions";
import { TITLE_MAX } from "@/lib/contracts/listings";
import { departureCreateSchema, departureSpaceSchema } from "@/lib/contracts/departures";
import { departureDescription, departureEnd, departureInputSchema, departureTitle, departureWindowIssue, repeatedDepartures, shiftDeparture, type DepartureInput } from "@/lib/carriers/departure";
import { canRenew, renew, transition } from "@/lib/listings/lifecycle";
import { assessReadiness, issuesByPath } from "@/lib/listings/readiness";
import { dayNumber } from "@/lib/listings/rental-availability";
import { ownerEditPath } from "@/lib/listings/client/routes";

// Carriers space, lot 2 (transporteurs/spec.md §3-4): a departure's facts and their checks, the
// title and text written from them, the recurrence, and the departure's own end: it leaves the site
// the day after it leaves, is never renewed, and is edited from « Mes départs » only.

const NOW = new Date("2026-11-10T10:00:00.000Z");
const TODAY = dayNumber("2026-11-10");
const LIFETIME = { ttlDays: 60, purgeMonths: 12 };
const ctx = { now: NOW, lifetime: LIFETIME, ip: "41.250.1.2" };

const DEPARTURE: DepartureInput = {
  direction: "eu_ma",
  departOn: "2026-11-20",
  depositBy: "2026-11-19",
  arriveFrom: "2026-11-22",
  arriveTo: "2026-11-24",
  euZones: ["FR-69", "FR-38", "FR-42"],
  maCities: ["nador", "oujda"],
  space: "some",
  spaceKg: 400,
  note: "Dépôt au 12 rue des Lilas, le soir.",
};

describe("departure facts", () => {
  it("takes a departure with its dates in order", () => {
    expect(departureInputSchema.safeParse(DEPARTURE).success).toBe(true);
  });

  it("refuses a deposit after the departure, an arrival before it or past 30 days, and repeated places", () => {
    const codes = (patch: Partial<DepartureInput>) => {
      const parsed = departureInputSchema.safeParse({ ...DEPARTURE, ...patch });
      return parsed.success ? [] : parsed.error.issues.map((issue) => `${String(issue.path[0])}:${issue.message}`);
    };
    expect(codes({ depositBy: "2026-11-21" })).toContain("depositBy:deposit_window");
    expect(codes({ depositBy: "2026-10-01" })).toContain("depositBy:deposit_window");
    expect(codes({ arriveFrom: "2026-11-19" })).toContain("arriveFrom:arrival_window");
    expect(codes({ arriveTo: "2026-11-21" })).toContain("arriveTo:arrival_window");
    expect(codes({ arriveTo: "2026-12-25" })).toContain("arriveTo:arrival_window");
    expect(codes({ departOn: "2026-02-30" })).toContain("departOn:invalid_day");
    expect(codes({ euZones: ["FR-69", "FR-69"] })).toContain("euZones:duplicate");
    expect(departureInputSchema.safeParse({ ...DEPARTURE, euZones: ["XX-01"] }).success).toBe(false);
    expect(departureInputSchema.safeParse({ ...DEPARTURE, maCities: [] }).success).toBe(false);
  });

  it("places a departure from today to 180 days ahead", () => {
    expect(departureWindowIssue("2026-11-10", TODAY)).toBeNull();
    expect(departureWindowIssue("2026-11-09", TODAY)).toBe("departure_past");
    expect(departureWindowIssue("2027-05-09", TODAY)).toBeNull();
    expect(departureWindowIssue("2027-05-10", TODAY)).toBe("departure_too_far");
    expect(DEPARTURE_LIMITS.aheadDays).toBe(180);
  });

  it("ends the day after the departure", () => {
    expect(departureEnd("2026-11-20").toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  it("moves every date together, and repeats every week or two weeks", () => {
    expect(shiftDeparture(DEPARTURE, 7)).toMatchObject({ departOn: "2026-11-27", depositBy: "2026-11-26", arriveFrom: "2026-11-29", arriveTo: "2026-12-01" });
    expect(repeatedDepartures(DEPARTURE, undefined)).toEqual([DEPARTURE]);
    const fortnightly = repeatedDepartures(DEPARTURE, { everyWeeks: 2, count: 4 });
    expect(fortnightly.map((departure) => departure.departOn)).toEqual(["2026-11-20", "2026-12-04", "2026-12-18", "2027-01-01"]);
    expect(repeatedDepartures(DEPARTURE, { everyWeeks: 1, count: 30 })).toHaveLength(DEPARTURE_LIMITS.repeatMax);
  });

  it("writes a short title and a French text from the facts, the note last", () => {
    expect(departureTitle(DEPARTURE)).toBe("Rhône +2 → Nador +1 · départ le 20/11/2026");
    expect(departureTitle({ ...DEPARTURE, direction: "ma_eu" })).toBe("Nador +1 → Rhône +2 · départ le 20/11/2026");
    const long = departureTitle({ ...DEPARTURE, euZones: ["FR-04"], maCities: ["casablanca"] });
    expect(long.length).toBeLessThanOrEqual(TITLE_MAX);
    const text = departureDescription(DEPARTURE);
    expect(text).toContain("Départ Europe → Maroc le 20/11/2026. Dépôt des colis jusqu'au 19/11/2026. Arrivée estimée entre le 22/11/2026 et le 24/11/2026.");
    expect(text).toContain("Collecte : Rhône, Isère, Loire.");
    expect(text).toContain(`Livraison : ${cityBySlug("nador")!.nameFr}, ${cityBySlug("oujda")!.nameFr}.`);
    expect(text.endsWith(DEPARTURE.note!)).toBe(true);
  });
});

describe("departure contracts", () => {
  it("takes a recurrence of 2 to 8 departures, every 1 or 2 weeks, with the rules accepted", () => {
    expect(departureCreateSchema.safeParse({ departure: DEPARTURE, acceptRules: true, repeat: { everyWeeks: 2, count: 8 } }).success).toBe(true);
    expect(departureCreateSchema.safeParse({ departure: DEPARTURE, acceptRules: true, repeat: { everyWeeks: 3, count: 4 } }).success).toBe(false);
    expect(departureCreateSchema.safeParse({ departure: DEPARTURE, acceptRules: true, repeat: { everyWeeks: 1, count: 9 } }).success).toBe(false);
    expect(departureCreateSchema.safeParse({ departure: DEPARTURE }).success).toBe(false);
  });

  it("sets the room left alone, the kilograms optional", () => {
    expect(departureSpaceSchema.safeParse({ space: "full" }).success).toBe(true);
    expect(departureSpaceSchema.safeParse({ space: "some", spaceKg: null }).success).toBe(true);
    expect(departureSpaceSchema.safeParse({ space: "empty" }).success).toBe(false);
  });
});

describe("a departure listing", () => {
  const stored = { ...DEPARTURE, spaceUpdatedAt: NOW };

  it("is a Pro subcategory of services without a price, made by its tool", () => {
    const subcategory = subcategoryById(DEPARTURE_SUBCATEGORY)!;
    expect(subcategory).toMatchObject({ categoryId: "services", proOnly: true, priceMode: "none", photosOptional: true, tool: "departures" });
    expect(ownerEditPath({ id: "abcdefgh", subcategoryId: DEPARTURE_SUBCATEGORY })).toBe("/pro/departs");
    expect(ownerEditPath({ id: "abcdefgh", subcategoryId: "cours" })).toBe("/deposer/abcdefgh");
  });

  it("goes online until the day after it leaves, whatever the lifetime, and is never renewed", () => {
    const draft = { status: "draft" as const, version: 0, sortAt: NOW, sortSource: "publish" as const, departure: stored };
    const published = transition(draft, "published", ctx);
    expect(published.patch.expiresAt).toEqual(new Date("2026-11-21T00:00:00.000Z"));
    const live = { ...draft, status: "published" as const, publishedAt: NOW, expiresAt: new Date("2026-11-21T00:00:00.000Z") };
    expect(canRenew(live, new Date("2026-11-18T10:00:00.000Z"))).toBe(false);
    expect(canRenew({ ...live, status: "expired" }, new Date("2026-11-22T10:00:00.000Z"))).toBe(false);
    expect(() => renew(live, { ...ctx, now: new Date("2026-11-18T10:00:00.000Z") })).toThrow();
  });

  it("does not publish without its facts", () => {
    const nador = cityBySlug("nador")!;
    const listing = {
      title: departureTitle(DEPARTURE),
      description: departureDescription(DEPARTURE),
      categoryId: "services",
      subcategoryId: DEPARTURE_SUBCATEGORY,
      attributes: { "departure-direction": "europe-maroc" },
      price: null,
      isDonation: false,
      location: { regionCode: nador.regionCode, citySlug: nador.slug, geo: { lat: nador.lat, lng: nador.lng } },
      photos: [],
      contact: { messaging: true as const, showPhone: true, whatsapp: true },
    };
    const facts = { seller: { type: "pro" as const, plan: "essentiel" as const }, phoneVerified: true };
    expect(assessReadiness({ ...listing, departure: stored }, facts)).toEqual([]);
    expect(issuesByPath(assessReadiness(listing, facts)).get("departure")).toEqual(["departure_required"]);
    expect(issuesByPath(assessReadiness({ ...listing, departure: stored }, { seller: { type: "individual" }, phoneVerified: true })).get("subcategoryId")).toEqual(["pro_only"]);
  });
});
