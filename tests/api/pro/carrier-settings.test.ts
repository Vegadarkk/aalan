import { randomInt } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

// Carriers space, lot 1b (transporteurs/spec.md §3) against the Firebase emulators: a carrier shop
// saves its settings and price list, read back by GET /api/pro/me; the cities must exist, the note
// passes the text screen, the price list's date moves only when it changes, and a shop that is not
// a carrier cannot save them.

import { GET as getMe } from "@/app/api/pro/me/route";
import { PUT as putCarrier } from "@/app/api/pro/me/carrier/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { ProCarrierInput, ProCarrierResponse, ProMeResponse } from "@/lib/contracts/pro";
import { getProProfile, proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { api, member, type ErrorBody, type Member } from "../listings/helpers";

const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");
const code = (body: unknown) => (body as ErrorBody).error.code;

beforeEach(() => resetRateLimiters());

/** A verified carrier shop registered in France, signed in as its owner. */
async function carrierShop(owner: Member, extra: Partial<ProProfileDoc> = {}): Promise<string> {
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
  return proId;
}

const SETTINGS: ProCarrierInput = {
  licenceRef: "LC 2024/069 001234",
  directions: ["eu_ma", "ma_eu"],
  euZones: ["FR-69", "FR-38", "FR-42"],
  maCities: ["agadir", "tiznit"],
  pickup: { depot: true, home: true },
  delivery: { depot: false, home: true },
  vehicle: { kind: "van", volumeM3: 20, payloadKg: 1200 },
  transitDays: { min: 3, max: 5 },
  tariff: {
    currency: "EUR",
    perKg: 250,
    bands: [{ fromKg: 60, perKg: 200 }],
    minimum: 2000,
    volumetricKgPerM3: 250,
    items: [{ item: "e-scooter", price: 6000 }],
    surcharges: [
      { kind: "pickup", value: 1000 },
      { kind: "peak", value: 15 },
    ],
  },
  refused: ["lithium-battery", "cash"],
  note: "Batteries démontées pour les trottinettes.",
};

const put = (owner: Member, body: unknown) => api<ProCarrierResponse & ErrorBody>(putCarrier, "PUT", "/api/pro/me/carrier", { member: owner, body });

describe("PUT /api/pro/me/carrier", () => {
  it("saves the carrier's settings, read back by the Pro space, and dates the price list's changes", async () => {
    const owner = await member();
    const proId = await carrierShop(owner);
    const saved = await put(owner, SETTINGS);
    expect(saved.status).toBe(200);
    expect(saved.body.carrier).toEqual(SETTINGS);
    const first = saved.body.carrierUpdatedAt;
    expect(first).toEqual(expect.any(String));
    expect((await getProProfile(proId))?.carrier).toEqual(SETTINGS);

    const self = await api<ProMeResponse>(getMe, "GET", "/api/pro/me", { member: owner });
    expect(self.body.shop).toMatchObject({ carrier: SETTINGS, carrierUpdatedAt: first });

    // The note alone changes: the price list keeps its date.
    const note = await put(owner, { ...SETTINGS, note: "Départ chaque vendredi." });
    expect(note.body.carrierUpdatedAt).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cheaper = await put(owner, { ...SETTINGS, tariff: { ...SETTINGS.tariff, perKg: 230 } });
    expect(cheaper.status).toBe(200);
    expect(Date.parse(cheaper.body.carrierUpdatedAt!)).toBeGreaterThan(Date.parse(first!));
  });

  it("refuses an unknown city, contact details in the note, a priced item it refuses and a bad price list", async () => {
    const owner = await member();
    await carrierShop(owner);
    const city = await put(owner, { ...SETTINGS, maCities: ["agadir", "atlantis"] });
    expect(city.status).toBe(400);
    expect(code(city.body)).toBe("invalid_body");
    const note = await put(owner, { ...SETTINGS, note: "Appelez le 06 12 34 56 78" });
    expect(note.status).toBe(422);
    expect(code(note.body)).toBe("invalid_text");
    expect(code((await put(owner, { ...SETTINGS, refused: ["e-scooter"] })).body)).toBe("invalid_body");
    expect(code((await put(owner, { ...SETTINGS, euZones: ["FR-99"] })).body)).toBe("invalid_body");
    expect(code((await put(owner, { ...SETTINGS, licenceRef: "" })).body)).toBe("invalid_body");
    expect(code((await put(owner, { ...SETTINGS, tariff: { ...SETTINGS.tariff, perKg: 20_000 } })).body)).toBe("invalid_body");
    expect(code((await put(owner, { ...SETTINGS, tariff: { ...SETTINGS.tariff, bands: [{ fromKg: 60, perKg: 200 }, { fromKg: 30, perKg: 180 }] } })).body)).toBe("invalid_body");
  });

  it("is for a carrier shop only", async () => {
    const owner = await member();
    await carrierShop(owner, { sector: "general", legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" } });
    const refused = await put(owner, SETTINGS);
    expect(refused.status).toBe(409);
    expect(code(refused.body)).toBe("conflict");
    const individual = await member();
    expect(code((await put(individual, SETTINGS)).body)).toBe("pro_not_verified");
  });
});
