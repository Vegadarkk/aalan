import { randomInt } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as RuntimeModule from "@/lib/config/runtime";

// Launch places of individuals (owner, 2026-11-11): a listing online plus a verified number gives
// 30 gift credits valid 90 days, one place per account and per number, counted with the shops'
// places; the credits pay options while sales are closed, never with purchased credits.

const flags = vi.hoisted(() => ({ salesEnabled: false, proSignupEnabled: true, paymentInstallmentsEnabled: false }));
vi.mock("@/lib/config/runtime", async (importOriginal) => ({ ...(await importOriginal<typeof RuntimeModule>()), getFlags: vi.fn(async () => ({ ...flags })) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));

import { POST as create } from "@/app/api/listings/route";
import { PATCH as patch } from "@/app/api/listings/[id]/route";
import { POST as publish } from "@/app/api/listings/[id]/publish/route";
import { GET as options, POST as buy } from "@/app/api/listings/[id]/options/route";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import type { BuyOptionResponse, ListingOptionsResponse } from "@/lib/contracts/payments";
import { updateListing } from "@/lib/db/repositories/listings";
import { launchOfferSeatsGranted, launchOfferSeatsRef } from "@/lib/db/repositories/pro-profiles";
import { getWallet, ledgerRef } from "@/lib/db/repositories/wallets";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { sendMail } from "@/lib/mail";
import { claimLaunchPlace } from "@/lib/payments/launch-place";
import { claimVerifiedPhone } from "@/lib/phone-verify/accounts";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { api, member, readyPatch, seedReadyUpload, type ErrorBody, type Member } from "../listings/helpers";

beforeAll(() => resetServerEnv());
beforeEach(() => {
  resetRateLimiters();
  flags.salesEnabled = false;
  vi.mocked(sendMail).mockClear();
});

const phone = () => `+2126${String(randomInt(10_000_000, 99_999_999))}`;
const code = (body: unknown) => (body as ErrorBody).error.code;

async function published(owner: Member): Promise<string> {
  const created = await api<CreateListingResponse>(create, "POST", "/api/listings", { member: owner, body: {} });
  const id = created.body.id;
  expect((await api(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: readyPatch() })).status).toBe(200);
  const upload = await seedReadyUpload(owner, id);
  expect((await api(patch, "PATCH", `/api/listings/${id}`, { member: owner, body: { photos: [upload] } })).status).toBe(200);
  expect((await api(publish, "POST", `/api/listings/${id}/publish`, { member: owner, body: { acceptRules: true } })).body).toMatchObject({ status: "published" });
  // Sorted two hours ago: a bump right after the publication is refused (bump_too_soon).
  await updateListing(id, { sortAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
  return id;
}

describe("an individual's launch place", () => {
  it("is given at the publication of a verified member: 30 credits for 90 days, counted, one per account", async () => {
    const owner = await member({ phone: phone() });
    const before = await launchOfferSeatsGranted();
    await published(owner);

    const wallet = await getWallet(owner.uid);
    expect(wallet).toMatchObject({ balance: 0, planCredits: 30 });
    const days = (wallet!.planCreditsResetsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);
    expect((await ledgerRef(owner.uid, "launch_place").get()).data()).toMatchObject({ reason: "launch_gift", delta: 0, planCreditsDelta: 30, actorUid: "system" });
    expect(await launchOfferSeatsGranted()).toBe(before + 1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ template: "launchPlaceGranted", data: expect.objectContaining({ credits: 30 }) }));

    // A second publication or call gives nothing more.
    await published(owner);
    expect(await claimLaunchPlace(owner.uid)).toBe("already");
    expect((await getWallet(owner.uid))?.planCredits).toBe(30);
    expect(await launchOfferSeatsGranted()).toBe(before + 1);
  });

  it("waits for the verified number, then is given at the verification", async () => {
    const owner = await member();
    await published(owner);
    expect(await getWallet(owner.uid)).toBeNull();
    expect(await claimLaunchPlace(owner.uid)).toBe("phone_unverified");

    await claimVerifiedPhone(owner.uid, phone());
    expect(await claimLaunchPlace(owner.uid)).toBe("granted");
    expect((await getWallet(owner.uid))?.planCredits).toBe(30);
  });

  it("is not given before a listing is online", async () => {
    const owner = await member({ phone: phone() });
    expect(await claimLaunchPlace(owner.uid)).toBe("no_listing");
  });

  it("goes once per number, even when the number moves to another account", async () => {
    const number = phone();
    const first = await member({ phone: number });
    await published(first);
    expect((await getWallet(first.uid))?.planCredits).toBe(30);

    const second = await member();
    await published(second);
    await claimVerifiedPhone(second.uid, number);
    expect(await claimLaunchPlace(second.uid)).toBe("phone_used");
    expect(await getWallet(second.uid)).toBeNull();
    // The marker holds no account id.
    const markers = await db().collection(COLLECTIONS.launchPlaces).get();
    for (const marker of markers.docs) expect(Object.keys(marker.data()).sort()).toEqual(["at", "purgeAt"]);
  });

  it("is not given once every place is taken", async () => {
    const owner = await member({ phone: phone() });
    const granted = await launchOfferSeatsGranted();
    await launchOfferSeatsRef().set({ granted: 1_000, updatedAt: new Date() });
    try {
      await published(owner);
      expect(await claimLaunchPlace(owner.uid)).toBe("full");
      expect(await getWallet(owner.uid)).toBeNull();
    } finally {
      await launchOfferSeatsRef().set({ granted, updatedAt: new Date() });
    }
  });
});

describe("gift credits while sales are closed", () => {
  const purchase = (owner: Member, id: string, optionId: string, expectedCost: number) =>
    api<BuyOptionResponse & ErrorBody>(buy, "POST", `/api/listings/${id}/options`, { member: owner, body: { optionId, requestId: crypto.randomUUID(), expectedCost, acceptTerms: true, immediateExecutionConsent: true } });

  it("pay an option that they cover, and only those", async () => {
    const owner = await member({ phone: phone() });
    const id = await published(owner);
    const read = await api<ListingOptionsResponse>(options, "GET", `/api/listings/${id}/options`, { member: owner });
    expect(read.body).toMatchObject({ salesOpen: false, optionsOpen: true, account: "personal", wallet: { planCredits: 30 } });
    // Vehicles tier (the bicycle of readyPatch): bump 20, À la Une 7 days 59.
    expect(read.body.options.find((offer) => offer.id === "bump")).toMatchObject({ price: 20, affordable: true });
    expect(read.body.options.find((offer) => offer.id === "featured7")).toMatchObject({ price: 59, affordable: false });

    const bumped = await purchase(owner, id, "bump", 20);
    expect(bumped.status).toBe(200);
    expect(bumped.body).toMatchObject({ cost: { planCredits: 20, credits: 0 }, wallet: { planCredits: 10, balance: 0 } });

    const tooDear = await purchase(owner, id, "featured7", 59);
    expect(tooDear.status).toBe(402);
    expect(code(tooDear.body)).toBe("insufficient_credits");
  });

  it("never let purchased credits pay while sales are closed", async () => {
    const owner = await member({ phone: phone() });
    const id = await published(owner);
    // 30 gift credits; a staging-like purchased balance on top must not complete a featured7 (59).
    const wallet = await getWallet(owner.uid);
    await db().collection(COLLECTIONS.wallets).doc(owner.uid).update({ balance: 100 });
    expect(wallet?.planCredits).toBe(30);
    const result = await purchase(owner, id, "featured7", 59);
    expect(result.status).toBe(403);
    expect(code(result.body)).toBe("sales_closed");
    expect(await getWallet(owner.uid)).toMatchObject({ balance: 100, planCredits: 30 });
  });

  it("keep options closed without them", async () => {
    const owner = await member();
    const id = await published(owner);
    const read = await api<ListingOptionsResponse>(options, "GET", `/api/listings/${id}/options`, { member: owner });
    expect(read.body).toMatchObject({ salesOpen: false, optionsOpen: false });
    const result = await purchase(owner, id, "bump", 20);
    expect(result.status).toBe(403);
    expect(code(result.body)).toBe("sales_closed");
  });
});
