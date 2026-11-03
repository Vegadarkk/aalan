import { randomInt } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Quota from "@/lib/quota";
import type * as Turnstile from "@/lib/security/turnstile";

// Contact of a shop from its storefront, without a listing (UX audit of the Pro shops, lot 1), on
// the emulators: POST /api/shops/{proId}/phone reveals the owner's verified number under the
// listing reveal rules (logged as a shop reveal, a repeat not logged), and POST
// /api/shops/{proId}/conversations opens one conversation per (shop, buyer), marked as a shop
// conversation and linked to the storefront. Switches off, example shops, the owner and unknown
// shops are refused.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", async (importOriginal) => ({ ...(await importOriginal<typeof Quota>()), firstDegraded: vi.fn(async () => null) }));
vi.mock("@/lib/security/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof Turnstile>()),
  verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })),
}));

import { POST as revealRoute } from "@/app/api/shops/[proId]/phone/route";
import { POST as startShopRoute } from "@/app/api/shops/[proId]/conversations/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import { MESSAGING_API } from "@/lib/contracts/endpoints";
import type { PhoneRevealResponse } from "@/lib/contracts/listings";
import type { StartConversationResponse } from "@/lib/contracts/messaging";
import { proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { listRevealLogs } from "@/lib/db/repositories/reveal-logs";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import { shopConversationId } from "@/lib/messaging/ids";
import { getConversation } from "@/lib/messaging/repository";
import { setMessagingValkeyForTests } from "@/lib/messaging/unread";
import { displayPhone } from "@/lib/phone/normalize";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { FakeValkey } from "../../unit/messaging-fake-valkey";
import { call, type ErrorBody, type Member } from "../favorites/helpers";
import { freshPhone, member } from "../listings/helpers";
import { row } from "../messaging/helpers";

const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");
const code = (body: unknown) => (body as ErrorBody).error.code;

beforeEach(() => {
  resetRateLimiters();
  setMessagingValkeyForTests(new FakeValkey().asClient());
});
afterAll(() => setMessagingValkeyForTests(undefined));

/** A verified shop of `owner` (signed in again as its owner), the contact switches as given. */
async function shop(owner: Member, extra: Partial<ProProfileDoc> = {}): Promise<{ proId: string; segment: string }> {
  const proId = newProId();
  const now = new Date();
  const slug = "maison-lalla";
  const profile: ProProfileDoc = {
    ownerUid: owner.uid,
    members: { [owner.uid]: "owner" },
    name: "Maison Lalla",
    slug,
    description: "Babouches et caftans cousus main.",
    whatsapp: true,
    showPhone: true,
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
  return { proId, segment: `${slug}-${proId}` };
}

const reveal = (viewer: Member | undefined, proId: string) => call<PhoneRevealResponse & ErrorBody>(revealRoute, "POST", MESSAGING_API.shopPhone(proId), { member: viewer, body: {}, params: { proId } });
const write = (who: Member | undefined, proId: string, text = "Bonjour, faites-vous des babouches sur mesure ?") =>
  call<StartConversationResponse & ErrorBody>(startShopRoute, "POST", MESSAGING_API.shopConversation(proId), { member: who, body: { text, turnstileToken: "ok" }, params: { proId } });

describe("POST /api/shops/{proId}/phone", () => {
  it("reveals the owner's verified number and WhatsApp, logged once per viewer as a shop reveal", async () => {
    const phone = freshPhone();
    const owner = await member({ phone });
    const { proId } = await shop(owner);
    const viewer = await member();

    const first = await reveal(viewer, proId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ phone: { e164: phone, display: displayPhone(phone), whatsappUrl: `https://wa.me/${phone.slice(1)}` } });
    const logs = await listRevealLogs(proId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ viewerUid: viewer.uid, listingId: proId, kind: "shop" });

    expect((await reveal(viewer, proId)).status).toBe(200);
    expect(await listRevealLogs(proId)).toHaveLength(1);
  });

  it("answers 404 with the switches off, for an example shop, an unverified number or an unknown shop", async () => {
    const off = await shop(await member({ phone: freshPhone() }), { showPhone: false, whatsapp: false });
    const example = await shop(await member({ phone: freshPhone() }), { example: true });
    const unverified = await shop(await member());
    const viewer = await member();
    for (const proId of [off.proId, example.proId, unverified.proId, newProId(), "NOT-AN-ID"]) {
      const result = await reveal(viewer, proId);
      expect(result.status, proId).toBe(404);
    }
    expect((await reveal(undefined, off.proId)).status).toBe(401);
  });
});

describe("POST /api/shops/{proId}/conversations", () => {
  it("opens one shop conversation per buyer, linked to the storefront, then appends to it", async () => {
    const owner = await member({ displayName: "Lalla Amina" });
    const { proId, segment } = await shop(owner);
    const buyer = await member({ displayName: "Youssef Acheteur" });

    const first = await write(buyer, proId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ cid: shopConversationId(proId, buyer.uid), existing: false });
    expect(await getConversation(first.body.cid)).toMatchObject({
      subject: "shop",
      listingId: proId,
      listingSlugId: segment,
      sellerUid: owner.uid,
      sellerProId: proId,
      buyerUid: buyer.uid,
      listingSnapshot: { title: "Maison Lalla", price: null, photo: null, offers: false },
    });
    const view = await row(owner, first.body.cid);
    expect(view.status).toBe(200);
    expect(view.body.conversation).toMatchObject({ subject: "shop", listingSlugId: segment, role: "seller" });

    const again = await write(buyer, proId, "Et livrez-vous à Rabat ?");
    expect(again.body).toMatchObject({ cid: first.body.cid, existing: true });
  });

  it("refuses the owner, an example shop and an unknown shop", async () => {
    const owner = await member();
    const { proId } = await shop(owner);
    expect(code((await write(owner, proId)).body)).toBe("self_conversation");

    const example = await shop(await member(), { example: true });
    const buyer = await member();
    expect(code((await write(buyer, example.proId)).body)).toBe("listing_unavailable");
    expect((await write(buyer, newProId())).status).toBe(404);
    expect((await write(buyer, "NOT-AN-ID")).status).toBe(404);
  });
});
