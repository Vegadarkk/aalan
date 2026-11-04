import { randomInt } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A verified shop without a plan (zone 6 audit 6-02): the deposit is refused at its start with the
// real cause (409 no_plan), not after nine steps with "maximum of active listings reached" for 0.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));

import { POST as create } from "@/app/api/listings/route";
import { PATCH as patch } from "@/app/api/listings/[id]/route";
import { POST as publish } from "@/app/api/listings/[id]/publish/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import { proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { api, member, readyPatch, seedReadyUpload, type ErrorBody, type ListingBody, type Member } from "./helpers";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

beforeEach(() => resetRateLimiters());

async function shop(owner: Member, extra: Partial<ProProfileDoc>): Promise<string> {
  const proId = newProId();
  const now = new Date();
  const profile: ProProfileDoc = {
    ownerUid: owner.uid,
    members: { [owner.uid]: "owner" },
    name: "Atlas Déco",
    slug: `atlas-deco-${proId}`,
    description: "Décoration.",
    whatsapp: false,
    regionCode: "07",
    citySlug: "marrakech",
    legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" },
    kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
    lifecycle: "verified",
    plan: "none",
    planSource: "none",
    quotas: DEFAULT_PRICING.pro.none,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await proProfileRef(proId).set(proProfileToFirestore(profile));
  await setClaims(owner.uid, { role: "pro", proId, proRole: "owner" });
  const minted = await createSessionForUid(owner.uid);
  owner.jar.cookies.set("__Host-session", minted.cookie);
  owner.jar.cookies.set("__Host-csrf", csrfToken(minted.cookie));
  return proId;
}

describe("a shop without a plan", () => {
  it("cannot start a listing: 409 no_plan", async () => {
    const owner = await member();
    await shop(owner, {});
    const result = await api<ErrorBody>(create, "POST", "/api/listings", { member: owner, body: {} });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("no_plan");
  });

  it("cannot publish a draft started under a plan since lost: 409 no_plan, not listing_limit", { timeout: 30_000 }, async () => {
    const owner = await member();
    const proId = await shop(owner, { lifecycle: "active", plan: "essentiel", planSource: "subscription", quotas: DEFAULT_PRICING.pro.essentiel });
    const id = (await api<CreateListingResponse>(create, "POST", "/api/listings", { member: owner, body: {} })).body.id;
    expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: readyPatch() })).status).toBe(200);
    const upload = await seedReadyUpload(owner, id);
    expect((await api<ListingBody>(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [upload] } })).status).toBe(200);
    await proProfileRef(proId).update({ lifecycle: "downgraded", plan: "none", planSource: "none" });
    const result = await api<ErrorBody>(publish, "POST", `/api/listings/${id}/publish`, { member: owner, body: { acceptRules: true } });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("no_plan");
  });
});
