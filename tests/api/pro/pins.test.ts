import { randomInt } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// « Sélection de la boutique » (UX audit of the Pro shops, lot 3) on the emulators: the owner pins
// published listings of the shop (never a member's, never a draft), « Mes annonces » returns the
// pins, and the storefront shows those still published, in order.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));

import { PUT as pinsRoute } from "@/app/api/pro/me/pins/route";
import { GET as mineRoute } from "@/app/api/listings/mine/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { OwnerListingsResponse } from "@/lib/contracts/listings";
import { PRO_API } from "@/lib/contracts/pro";
import { listingRef } from "@/lib/db/repositories/listings";
import { proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import { getPublicStorefront } from "@/lib/listings/public";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { call, type ErrorBody, type Member } from "../favorites/helpers";
import { freshPhone, member } from "../listings/helpers";
import { seedListing } from "../messaging/helpers";

const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");

beforeEach(() => {
  resetRateLimiters();
});

async function shop(owner: Member): Promise<string> {
  const proId = newProId();
  const now = new Date();
  const profile: ProProfileDoc = {
    ownerUid: owner.uid,
    members: { [owner.uid]: "owner" },
    name: "Maison Lalla",
    slug: "maison-lalla",
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
  };
  await proProfileRef(proId).set(proProfileToFirestore(profile));
  await db().collection(COLLECTIONS.users).doc(owner.uid).update({ proId });
  await setClaims(owner.uid, { role: "pro", proId, proRole: "owner", v: 2 });
  const minted = await createSessionForUid(owner.uid);
  owner.jar.cookies.set("__Host-session", minted.cookie);
  owner.jar.cookies.set("__Host-csrf", csrfToken(minted.cookie));
  return proId;
}

const pins = (owner: Member, listingIds: string[]) => call<{ pinned: string[] } & ErrorBody>(pinsRoute, "PUT", PRO_API.pins, { member: owner, body: { listingIds } });

describe("pinned listings", () => {
  it("pins the shop's published listings, shows them on the storefront and refuses the others", async () => {
    const owner = await member({ phone: freshPhone() });
    const proId = await shop(owner);
    const account = (await db().collection(COLLECTIONS.users).doc(owner.uid).get()).data() as { displayName: string; publicId: string };
    const pro = { sellerType: "pro" as const, proId, sellerName: account.displayName, sellerPublicId: account.publicId };
    const first = await seedListing(owner, pro);
    const second = await seedListing(owner, pro);
    const draft = await seedListing(owner, { ...pro, status: "draft" });
    const someone = await seedListing(await member());

    const saved = await pins(owner, [second.id, first.id]);
    expect(saved.status).toBe(200);
    expect(saved.body.pinned).toEqual([second.id, first.id]);

    for (const refused of [[draft.id], [someone.id]]) {
      const answer = await pins(owner, refused);
      expect(answer.status).toBe(422);
      expect(answer.body.error.code).toBe("invalid_body");
    }
    expect((await pins(owner, [first.id, first.id])).status).toBe(400);

    const mine = await call<OwnerListingsResponse>(mineRoute, "GET", "/api/listings/mine?status=active", { member: owner });
    expect(mine.body.pinned).toEqual([second.id, first.id]);

    // A pinned listing that stops being published leaves the selection.
    await listingRef(second.id).update({ status: "paused" });
    const store = await getPublicStorefront(proId);
    expect(store?.pinned.map((card) => card.id)).toEqual([first.id]);
  });

  it("answers a member without a shop with pro_not_verified", async () => {
    const someone = await member();
    const answer = await pins(someone, []);
    expect(answer.status).toBe(409);
    expect(answer.body.error.code).toBe("pro_not_verified");
  });
});
