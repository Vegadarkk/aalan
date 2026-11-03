import { randomInt } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// PUT /api/pro/me (UX audit of the Pro shops, lot 1) against the emulators: the owner of a verified
// shop saves its card (presentation FR/AR, city, address, hours, contact switches, website,
// banner), read back by GET /api/pro/me and shown by the storefront; texts with contact details,
// a number without a verified phone, broken hours and an account without a shop are refused.

vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));

import { GET as getMe } from "@/app/api/pro/me/route";
import { PUT as putCard } from "@/app/api/pro/me/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { ProMeResponse, ProShopCardInput, ProShopCardResponse } from "@/lib/contracts/pro";
import { getPublicStorefront } from "@/lib/listings/public";
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

/** A verified shop on the launch offer, linked to its owner's account and signed in as its owner. */
async function shop(owner: Member, extra: Partial<ProProfileDoc> = {}): Promise<string> {
  const proId = newProId();
  const now = new Date();
  const profile: ProProfileDoc = {
    ownerUid: owner.uid,
    members: { [owner.uid]: "owner" },
    name: "Atlas Immobilier",
    slug: `atlas-immobilier-${proId}`,
    description: "Appartements et villas à Casablanca.",
    whatsapp: false,
    regionCode: "06",
    citySlug: "casablanca",
    legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" },
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

const put = (owner: Member, body: unknown) => api<ProShopCardResponse & ErrorBody>(putCard, "PUT", "/api/pro/me", { member: owner, body });

const CARD: ProShopCardInput = {
  description: "Babouches et caftans cousus main.",
  descriptionAr: "بلاغي وقفاطين مخيطة باليد.",
  citySlug: "fes",
  address: "12 derb Sidi Ahmed, Fès Jdid",
  hours: { days: [{ day: "mon", slots: [{ from: "09:00", to: "12:30" }, { from: "14:30", to: "19:00" }] }, { day: "sat", slots: [{ from: "10:00", to: "18:00" }] }], note: "Fermé les jours fériés" },
  showPhone: false,
  whatsapp: false,
  website: "https://maison-lalla.ma",
  bannerKey: "dunes",
};

describe("PUT /api/pro/me", () => {
  it("saves the card, reads it back and shows it on the storefront", async () => {
    const owner = await member();
    const proId = await shop(owner);
    const set = await put(owner, { ...CARD, address: `  ${CARD.address}  ` });
    expect(set.status).toBe(200);
    expect(set.body.card).toEqual({ ...CARD, logo: null, phoneVerified: false });
    const profile = await getProProfile(proId);
    expect(profile).toMatchObject({ citySlug: "fes", regionCode: "03", address: CARD.address, bannerKey: "dunes", website: CARD.website, descriptionAr: CARD.descriptionAr });
    const read = await api<ProMeResponse>(getMe, "GET", "/api/pro/me", { member: owner });
    expect(read.body.shop?.card).toEqual({ ...CARD, logo: null, phoneVerified: false });

    const store = await getPublicStorefront(proId);
    expect(store).toMatchObject({ address: CARD.address, hours: CARD.hours, website: CARD.website, bannerKey: "dunes", descriptionAr: CARD.descriptionAr, contact: { phone: false, whatsapp: false } });

    // Emptied fields go away.
    const cleared = await put(owner, { ...CARD, descriptionAr: "", address: "", hours: null, website: "" });
    expect(cleared.status).toBe(200);
    const after = await getProProfile(proId);
    expect(after?.descriptionAr).toBeUndefined();
    expect(after?.address).toBeUndefined();
    expect(after?.hours).toBeUndefined();
    expect(after?.website).toBeUndefined();
  });

  it("refuses texts with contact details, broken hours, a number without a verified phone", async () => {
    const owner = await member();
    await shop(owner);
    const phone = await put(owner, { ...CARD, address: "Appelez le 06 12 34 56 78" });
    expect(phone.status).toBe(422);
    expect((phone.body as unknown as { error: { details: unknown } }).error.details).toEqual({ field: "address", issue: "phone_in_text" });
    const note = await put(owner, { ...CARD, hours: { ...CARD.hours!, note: "écrivez à contact@exemple.ma" } });
    expect(note.status).toBe(422);
    expect((note.body as unknown as { error: { details: { field: string } } }).error.details.field).toBe("hours.note");
    expect((await put(owner, { ...CARD, hours: { days: [{ day: "mon", slots: [{ from: "19:00", to: "09:00" }] }], note: "" } })).status).toBe(400);
    expect((await put(owner, { ...CARD, website: "http://maison-lalla.ma" })).status).toBe(400);
    const number = await put(owner, { ...CARD, showPhone: true });
    expect(number.status).toBe(409);
    expect(code(number.body)).toBe("phone_required");
  });

  it("shows the contact switches once the number is verified", async () => {
    const owner = await member();
    const proId = await shop(owner);
    await db().collection(COLLECTIONS.users).doc(owner.uid).update({ "badges.phoneVerified": true });
    const set = await put(owner, { ...CARD, showPhone: true, whatsapp: true });
    expect(set.status).toBe(200);
    expect(set.body.card).toMatchObject({ showPhone: true, whatsapp: true, phoneVerified: true });
    expect((await getPublicStorefront(proId))?.contact).toEqual({ phone: true, whatsapp: true });
  });

  it("refuses an account without a shop and a suspended shop", async () => {
    const individual = await member();
    const none = await put(individual, CARD);
    expect(none.status).toBe(409);
    expect(code(none.body)).toBe("pro_not_verified");
    const suspended = await member();
    await shop(suspended, { lifecycle: "suspended", suspendedFrom: "verified" });
    expect(code((await put(suspended, CARD)).body)).toBe("pro_not_verified");
  });
});
