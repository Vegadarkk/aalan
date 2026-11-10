import { randomInt } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RuntimeModule from "@/lib/config/runtime";

// Carriers space, lot 2 (transporteurs/spec.md §4) against the Firebase emulators: « Mes départs »
// publishes a carrier's departures (one, or a recurrence) through the listing service, within the
// carrier's own price list, sets the room left in one tap, edits the facts, and keeps the wizard's
// tools (duplicate, subcategory change) away from departures.

const flags = vi.hoisted(() => ({ carriersEnabled: true }));
vi.mock("@/lib/config/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeModule>();
  return {
    ...actual,
    getFlags: vi.fn(async () => ({ ...(await actual.getFlags()), carriersEnabled: flags.carriersEnabled })),
  };
});
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })) }));

import { POST as postListing } from "@/app/api/listings/route";
import { PATCH as patchListing } from "@/app/api/listings/[id]/route";
import { POST as postDuplicate } from "@/app/api/listings/[id]/duplicate/route";
import { PUT as putCarrier } from "@/app/api/pro/me/carrier/route";
import { GET as getDepartures, POST as postDepartures } from "@/app/api/pro/departures/route";
import { PUT as putDeparture } from "@/app/api/pro/departures/[id]/route";
import { PUT as putSpace } from "@/app/api/pro/departures/[id]/space/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import { DEPARTURE_API, type DepartureCreateResponse, type DepartureResponse, type DeparturesResponse } from "@/lib/contracts/departures";
import type { ProCarrierInput } from "@/lib/contracts/pro";
import { departureEnd, type DepartureInput } from "@/lib/carriers/departure";
import { getListing } from "@/lib/db/repositories/listings";
import { proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import { dayString, moroccoToday } from "@/lib/listings/rental-availability";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { api, freshPhone, member, type ErrorBody, type Member } from "../listings/helpers";

const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");
const code = (body: unknown) => (body as ErrorBody).error.code;
const details = (body: unknown) => (body as { error: { details?: { path: string; code: string }[] } }).error.details ?? [];

beforeEach(() => {
  resetRateLimiters();
  flags.carriersEnabled = true;
});

const SETTINGS: ProCarrierInput = {
  licenceRef: "LC 2024/069 001234",
  directions: ["eu_ma"],
  euZones: ["FR-69", "FR-38", "FR-42"],
  maCities: ["agadir", "tiznit"],
  pickup: { depot: true, home: true },
  delivery: { depot: false, home: true },
  vehicle: { kind: "van", volumeM3: 20, payloadKg: 1200 },
  transitDays: { min: 3, max: 5 },
  tariff: { currency: "EUR", perKg: 250, bands: [{ fromKg: 60, perKg: 200 }], minimum: 2000, volumetricKgPerM3: 250, items: [], surcharges: [] },
  refused: [],
  note: "",
};

/** A verified carrier shop with its settings saved, signed in as its owner (phone verified). */
async function carrier(extra: Partial<ProProfileDoc> = {}): Promise<Member> {
  const owner = await member({ phone: freshPhone() });
  const proId = newProId();
  const now = new Date();
  const profile: ProProfileDoc = {
    ownerUid: owner.uid,
    members: { [owner.uid]: "owner" },
    name: "Trans Atlas Express",
    slug: `trans-atlas-express-${proId}`,
    description: "Départs chaque semaine de Lyon vers le Souss.",
    whatsapp: false,
    regionCode: "09",
    citySlug: "agadir",
    sector: "carrier",
    legal: { form: "entreprise_ue", country: "FR", registry: "73282932000074" },
    kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
    lifecycle: "verified",
    plan: "essentiel",
    planSource: "launch_offer",
    quotas: DEFAULT_PRICING.pro.essentiel,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await proProfileRef(proId).set(proProfileToFirestore(profile));
  await db().collection(COLLECTIONS.users).doc(owner.uid).update({ proId });
  await setClaims(owner.uid, { role: "pro", proId, proRole: "owner", v: 2 });
  const minted = await createSessionForUid(owner.uid);
  owner.jar.cookies.set("__Host-session", minted.cookie);
  owner.jar.cookies.set("__Host-csrf", csrfToken(minted.cookie));
  if (profile.sector === "carrier") expect((await api(putCarrier, "PUT", "/api/pro/me/carrier", { member: owner, body: SETTINGS })).status).toBe(200);
  return owner;
}

/** A departure `days` days from today (Morocco), within the carrier's price list. */
function departure(days = 10, patch: Partial<DepartureInput> = {}): DepartureInput {
  const today = moroccoToday(new Date());
  return {
    direction: "eu_ma",
    departOn: dayString(today + days),
    depositBy: dayString(today + days - 1),
    arriveFrom: dayString(today + days + 2),
    arriveTo: dayString(today + days + 4),
    euZones: ["FR-69", "FR-38"],
    maCities: ["agadir"],
    space: "some",
    spaceKg: 300,
    note: "Dépôt au dépôt de Vénissieux le soir.",
    ...patch,
  };
}

const create = (owner: Member, body: unknown) => api<DepartureCreateResponse & ErrorBody>(postDepartures, "POST", DEPARTURE_API.list, { member: owner, body });
const list = (owner: Member) => api<DeparturesResponse & ErrorBody>(getDepartures, "GET", DEPARTURE_API.list, { member: owner });

describe("POST /api/pro/departures", () => {
  it("publishes a departure as a listing that ends the day after it leaves, listed in « Mes départs »", async () => {
    const owner = await carrier();
    const first = departure();
    const created = await create(owner, { departure: first, acceptRules: true });
    expect(created.status).toBe(200);
    expect(created.body.failed).toBeNull();
    expect(created.body.created).toHaveLength(1);
    const [entry] = created.body.created;
    expect(["published", "pending_review"]).toContain(entry!.status);

    const stored = await getListing(entry!.id);
    expect(stored).toMatchObject({ subcategoryId: "departs-europe-maroc", categoryId: "services", price: null, location: { citySlug: "agadir" }, attributes: { "departure-direction": "europe-maroc" } });
    expect(stored!.title).toContain("Rhône");
    expect(stored!.description).toContain("Collecte : Rhône, Isère.");
    expect(stored!.departure).toMatchObject({ departOn: first.departOn, space: "some", spaceKg: 300, note: first.note });
    if (stored!.status === "published") expect(stored!.expiresAt).toEqual(departureEnd(first.departOn));

    const mine = await list(owner);
    expect(mine.status).toBe(200);
    expect(mine.body.open).toBe(true);
    expect(mine.body.settings).toMatchObject({ directions: ["eu_ma"], maCities: ["agadir", "tiznit"] });
    expect(mine.body.upcoming.map((view) => view.id)).toEqual([entry!.id]);
    expect(mine.body.past).toEqual([]);
  });

  it("publishes every departure of a recurrence, in date order", async () => {
    const owner = await carrier();
    const created = await create(owner, { departure: departure(5), acceptRules: true, repeat: { everyWeeks: 2, count: 3 } });
    expect(created.status).toBe(200);
    const today = moroccoToday(new Date());
    expect(created.body.created.map((entry) => entry.departOn)).toEqual([dayString(today + 5), dayString(today + 19), dayString(today + 33)]);
    const mine = await list(owner);
    expect(mine.body.upcoming.map((view) => view.departure.departOn)).toEqual(created.body.created.map((entry) => entry.departOn));
  });

  it("keeps a departure within the carrier's price list and its dates", async () => {
    const owner = await carrier();
    const refused = async (body: unknown) => {
      const response = await create(owner, body);
      expect(response.status).toBe(400);
      return details(response.body).map((detail) => `${detail.path}:${detail.code}`);
    };
    expect(await refused({ departure: departure(10, { euZones: ["FR-75"] }), acceptRules: true })).toEqual(["departure.euZones.0:zone_not_served"]);
    expect(await refused({ departure: departure(10, { maCities: ["nador"] }), acceptRules: true })).toEqual(["departure.maCities.0:city_not_served"]);
    expect(await refused({ departure: departure(10, { direction: "ma_eu" }), acceptRules: true })).toEqual(["departure.direction:direction_not_served"]);
    expect(await refused({ departure: departure(-2), acceptRules: true })).toEqual(["departure.departOn:departure_past"]);
    // A recurrence is checked whole before anything is published.
    expect(await refused({ departure: departure(170), acceptRules: true, repeat: { everyWeeks: 2, count: 2 } })).toEqual(["departure.departOn:departure_too_far"]);
    expect(code((await create(owner, { departure: departure() })).body)).toBe("invalid_body");
    expect((await list(owner)).body.upcoming).toEqual([]);
  });

  it("is closed with the carriers space, and for carrier shops only", async () => {
    const owner = await carrier();
    flags.carriersEnabled = false;
    const closed = await create(owner, { departure: departure(), acceptRules: true });
    expect(closed.status).toBe(403);
    expect(code(closed.body)).toBe("carriers_closed");
    expect((await list(owner)).body.open).toBe(false);
    flags.carriersEnabled = true;

    const general = await carrier({ sector: "general", legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" } });
    const notCarrier = await create(general, { departure: departure(), acceptRules: true });
    expect(notCarrier.status).toBe(409);
    const individual = await member();
    expect((await create(individual, { departure: departure(), acceptRules: true })).status).toBe(403);
  });

  it("asks for the settings first", async () => {
    const owner = await carrier();
    const user = await db().collection(COLLECTIONS.users).doc(owner.uid).get();
    await proProfileRef(user.get("proId") as string).update({ carrier: FieldValue.delete() });
    const missing = await create(owner, { departure: departure(), acceptRules: true });
    expect(missing.status).toBe(422);
    expect(code(missing.body)).toBe("carrier_settings_missing");
  });
});

describe("a published departure", () => {
  async function published(owner: Member, days = 10) {
    const created = await create(owner, { departure: departure(days), acceptRules: true });
    expect(created.status).toBe(200);
    return created.body.created[0]!.id;
  }

  it("sets its room left in one tap, the kilograms dropped when full", async () => {
    const owner = await carrier();
    const id = await published(owner);
    const before = (await getListing(id))!.departure!.spaceUpdatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const space = (body: unknown) => api<DepartureResponse & ErrorBody>(putSpace, "PUT", DEPARTURE_API.space(id), { member: owner, body, params: { id } });
    const almost = await space({ space: "almost_full", spaceKg: 80 });
    expect(almost.status).toBe(200);
    expect(almost.body.departure.departure).toMatchObject({ space: "almost_full", spaceKg: 80 });
    expect(Date.parse(almost.body.departure.departure.spaceUpdatedAt)).toBeGreaterThan(before.getTime());
    const full = await space({ space: "full", spaceKg: 50 });
    expect(full.body.departure.departure).toMatchObject({ space: "full", spaceKg: null });
    expect((await getListing(id))!.departure!.spaceKg).toBeUndefined();

    const other = await carrier();
    expect((await api(putSpace, "PUT", DEPARTURE_API.space(id), { member: other, body: { space: "lots" }, params: { id } })).status).toBe(404);
  });

  it("is edited from its facts, title, text and end written again", async () => {
    const owner = await carrier();
    const id = await published(owner);
    const later = departure(17, { euZones: ["FR-42"], maCities: ["tiznit"], note: "" });
    const edited = await api<DepartureResponse & ErrorBody>(putDeparture, "PUT", DEPARTURE_API.one(id), { member: owner, body: { departure: later }, params: { id } });
    expect(edited.status).toBe(200);
    expect(edited.body.departure.departure).toMatchObject({ departOn: later.departOn, euZones: ["FR-42"], maCities: ["tiznit"], note: "" });
    const stored = await getListing(id);
    expect(stored!.title).toContain("Loire");
    expect(stored!.location!.citySlug).toBe("tiznit");
    expect(stored!.departure!.note).toBeUndefined();
    if (stored!.status === "published") expect(stored!.expiresAt).toEqual(departureEnd(later.departOn));

    const outside = await api(putDeparture, "PUT", DEPARTURE_API.one(id), { member: owner, body: { departure: departure(10, { maCities: ["nador"] }) }, params: { id } });
    expect(outside.status).toBe(400);
  });

  it("stays out of the wizard: no draft, no duplicate, no move to another subcategory", async () => {
    const owner = await carrier();
    const id = await published(owner);
    const draft = await api(postListing, "POST", "/api/listings", { member: owner, body: { subcategoryId: "departs-europe-maroc" } });
    expect(draft.status).toBe(400);
    expect(details(draft.body)).toEqual([expect.objectContaining({ path: "subcategoryId", code: "tool_only" })]);
    expect((await api(postDuplicate, "POST", `/api/listings/${id}/duplicate`, { member: owner })).status).toBe(409);
    const moved = await api(patchListing, "PATCH", `/api/listings/${id}`, { member: owner, body: { subcategoryId: "cours" } });
    expect(moved.status).toBe(400);
  });
});
