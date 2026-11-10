import { randomInt } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Quota from "@/lib/quota";
import type * as Turnstile from "@/lib/security/turnstile";

// Shop counters (UX audit of the Pro shops, lot 1; spec §5 "Compteurs") on the emulators: the view
// beacon counts one view per visitor and day and never the shop's own, contacts and reveals are
// counted by the routes that make them, stats-flush writes the closed day into shopStats (listing
// views given to their shop, members' listings left out) and adds every listing's views and
// contacts to listingStats (audit C1-03, shown in « Mes annonces ») before deleting the Valkey hash,
// and GET /api/pro/me/stats sums 7 and 30 days with the most viewed listings.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", async (importOriginal) => ({ ...(await importOriginal<typeof Quota>()), firstDegraded: vi.fn(async () => null) }));
vi.mock("@/lib/security/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof Turnstile>()),
  verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })),
}));

import { POST as viewRoute } from "@/app/api/stats/view/route";
import { GET as statsRoute } from "@/app/api/pro/me/stats/route";
import { GET as mineRoute } from "@/app/api/listings/mine/route";
import { POST as revealRoute } from "@/app/api/shops/[proId]/phone/route";
import { POST as startShopRoute } from "@/app/api/shops/[proId]/conversations/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { OwnerListingsResponse } from "@/lib/contracts/listings";
import { MESSAGING_API, STATS_API } from "@/lib/contracts/endpoints";
import { PRO_API, type ShopStatsResponse } from "@/lib/contracts/pro";
import { getListingStats, listingStatsRef } from "@/lib/db/repositories/listing-stats";
import { listingRef } from "@/lib/db/repositories/listings";
import { proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import { setMessagingValkeyForTests } from "@/lib/messaging/unread";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { STATS_KEYS, setStatsValkeyForTests, statsDay } from "@/lib/stats/counters";
import { statsFlush } from "@/lib/stats/flush";
import { FakeValkey } from "../../unit/messaging-fake-valkey";
import { call, type ErrorBody, type Member } from "../favorites/helpers";
import { freshPhone, member } from "../listings/helpers";
import { seedListing, startOk } from "../messaging/helpers";

const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");
const DAY_MS = 24 * 3_600_000;

let valkey: FakeValkey;

beforeEach(() => {
  resetRateLimiters();
  valkey = new FakeValkey();
  setStatsValkeyForTests(valkey.asClient() as never);
  setMessagingValkeyForTests(new FakeValkey().asClient());
});
afterAll(() => {
  setStatsValkeyForTests(undefined);
  setMessagingValkeyForTests(undefined);
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

const view = (scope: "shop" | "listing", id: string, options: { member?: Member; ip?: string } = {}) => call<ErrorBody | null>(viewRoute, "POST", STATS_API.view, { body: { scope, id }, ...options });
const today = () => statsDay(new Date());
const yesterday = () => statsDay(new Date(Date.now() - DAY_MS));

/** Today's counters as if they were yesterday's (a closed day for stats-flush). */
function closeToday(): void {
  const hash = valkey.hashes.get(STATS_KEYS.day(today()));
  if (!hash) throw new Error("no counters today");
  valkey.hashes.delete(STATS_KEYS.day(today()));
  valkey.hashes.set(STATS_KEYS.day(yesterday()), hash);
}

describe("shop counters", () => {
  it("counts views, contacts and reveals, flushes them into shopStats and sums them for the Pro space", async () => {
    const owner = await member({ phone: freshPhone() });
    const proId = await shop(owner);
    const account = (await db().collection(COLLECTIONS.users).doc(owner.uid).get()).data() as { displayName: string; publicId: string };
    const listing = await seedListing(owner, { sellerType: "pro", proId, sellerName: account.displayName, sellerPublicId: account.publicId });
    const individual = await seedListing(await member());

    // Storefront: one view per visitor and day, the owner's own not counted.
    expect((await view("shop", proId, { ip: "10.61.0.1" })).status).toBe(204);
    expect((await view("shop", proId, { ip: "10.61.0.1" })).status).toBe(204);
    await view("shop", proId, { ip: "10.62.0.1" });
    await view("shop", proId, { member: owner, ip: "10.63.0.1" });
    // Listings: the shop's (2 visitors) and a member's.
    await view("listing", listing.id, { ip: "10.61.0.1" });
    await view("listing", listing.id, { ip: "10.64.0.1" });
    await view("listing", individual.id, { ip: "10.61.0.1" });
    // Malformed ids are ignored, still 204.
    expect((await view("shop", "NOT-AN-ID")).status).toBe(204);

    // Contacts: one about the listing, one to the shop; one reveal of the shop's number.
    const buyer = await member();
    await startOk(buyer, listing.id);
    const second = await member();
    const started = await call(startShopRoute, "POST", MESSAGING_API.shopConversation(proId), { member: second, body: { text: "Bonjour, livrez-vous à Rabat ?", turnstileToken: "ok" }, params: { proId } });
    expect(started.status).toBe(201);
    expect((await call(revealRoute, "POST", MESSAGING_API.shopPhone(proId), { member: buyer, body: {}, params: { proId } })).status).toBe(200);

    const hash = Object.fromEntries(valkey.hashes.get(STATS_KEYS.day(today())) ?? []);
    expect(hash).toMatchObject({ [`s:${proId}:v`]: "2", [`l:${listing.id}:v`]: "2", [`l:${individual.id}:v`]: "1", [`l:${listing.id}:c`]: "1", [`s:${proId}:c`]: "2", [`s:${proId}:r`]: "1" });

    closeToday();
    const flushed = await statsFlush();
    expect(flushed.days).toEqual([yesterday()]);
    expect(valkey.hashes.has(STATS_KEYS.day(yesterday()))).toBe(false);
    const doc = (await db().collection(COLLECTIONS.shopStats).doc(proId).get()).data() as { days: Record<string, unknown> };
    expect(doc.days[yesterday()]).toEqual({ v: 2, lv: 2, c: 2, r: 1, l: { [listing.id]: [2, 1] } });

    const read = await call<ShopStatsResponse & ErrorBody>(statsRoute, "GET", PRO_API.stats, { member: owner });
    expect(read.status).toBe(200);
    const totals = { storefrontViews: 2, listingViews: 2, contacts: 2, reveals: 1 };
    expect(read.body).toEqual({ last7: totals, last30: totals, topListings: [{ id: listing.id, title: "Vélo de ville Peugeot", slugId: listing.slugId, views: 2, contacts: 1 }], through: yesterday() });

    // listingStats: every listing's views and contacts, a member's included.
    expect(await getListingStats(listing.id)).toMatchObject({ views: 2, contacts: 1, favorites: 0, phoneReveals: 0 });
    expect(await getListingStats(individual.id)).toMatchObject({ views: 1, contacts: 0, favorites: 0, phoneReveals: 0 });

    // A second run finds nothing left to write.
    expect((await statsFlush()).days).toEqual([]);
  });

  it("adds a listing's counts once when a run is repeated, skips purged listings and shows the counts in « Mes annonces »", async () => {
    const seller = await member();
    const listing = await seedListing(seller);
    const purged = await seedListing(seller);
    await listingRef(purged.id).set({ status: "purged", purgedAt: new Date(), version: 2, updatedAt: new Date() });
    // A run cut short after its listing batch: the hash still holds the day, with the marker.
    valkey.hashes.set(STATS_KEYS.day(yesterday()), new Map([[`l:${listing.id}:v`, "3"], [`l:${listing.id}:c`, "2"], [`l:${purged.id}:v`, "4"]]));
    expect((await statsFlush()).days).toEqual([yesterday()]);
    expect(await getListingStats(listing.id)).toMatchObject({ views: 3, contacts: 2 });
    expect((await listingStatsRef(purged.id).get()).exists).toBe(false);
    valkey.hashes.set(STATS_KEYS.day(yesterday()), new Map([[`l:${listing.id}:v`, "3"], [`l:${listing.id}:c`, "2"], [`x:${listing.id}`, "1"]]));
    expect((await statsFlush()).days).toEqual([yesterday()]);
    expect(await getListingStats(listing.id)).toMatchObject({ views: 3, contacts: 2 });

    const mine = await call<OwnerListingsResponse>(mineRoute, "GET", "/api/listings/mine?status=active", { member: seller });
    expect(mine.status).toBe(200);
    expect(mine.body.listings.find((row) => row.id === listing.id)?.stats).toEqual({ views: 3, contacts: 2 });
    // Other tabs read no counters.
    const drafts = await call<OwnerListingsResponse>(mineRoute, "GET", "/api/listings/mine?status=drafts", { member: seller });
    expect(drafts.body.listings.every((row) => row.stats === undefined)).toBe(true);
  });

  it("answers an account without a shop with pro_not_verified", async () => {
    const someone = await member();
    const read = await call<ErrorBody>(statsRoute, "GET", PRO_API.stats, { member: someone });
    expect(read.status).toBe(409);
    expect(read.body.error.code).toBe("pro_not_verified");
  });
});
