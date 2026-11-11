import { randomInt } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Quota from "@/lib/quota";
import type * as Turnstile from "@/lib/security/turnstile";

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", async (importOriginal) => ({ ...(await importOriginal<typeof Quota>()), firstDegraded: vi.fn(async () => null), isDegraded: vi.fn(async () => false) }));
vi.mock("@/lib/security/turnstile", async (importOriginal) => ({ ...(await importOriginal<typeof Turnstile>()), verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })) }));

import { POST as carrierRequestRoute } from "@/app/api/conversations/[cid]/carrier-request/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import { DEPARTURE_SUBCATEGORY } from "@/config/categories";
import type { CarrierRequestResponse } from "@/lib/contracts/carrier-requests";
import { MESSAGING_API } from "@/lib/contracts/endpoints";
import { proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { dayString, moroccoToday } from "@/lib/listings/rental-availability";
import { setEventPublisherForTests } from "@/lib/messaging/events";
import { setMessagingValkeyForTests } from "@/lib/messaging/unread";
import type { CarrierSettings } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { FakeValkey } from "../../unit/messaging-fake-valkey";
import { call, type CallResult } from "../favorites/helpers";
import { expectError, member, row, seedListing, start, thread, type ErrorBody, type Member } from "./helpers";

// Place requests on a carrier's departure on the emulators (transporteurs/spec.md §5): the first
// message carries the basket, priced with the carrier's list (an estimate); the carrier answers
// « Place réservée » or « Pas de place »; the client withdraws or replaces it; every step is a
// system message; a past, full or non-departure listing and the wrong participant are refused.

const day = (offset: number) => dayString(moroccoToday(new Date()) + offset);
const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");

beforeEach(() => {
  resetRateLimiters();
  setMessagingValkeyForTests(new FakeValkey().asClient());
  setEventPublisherForTests(async () => {});
});

afterAll(() => {
  setMessagingValkeyForTests(undefined);
  setEventPublisherForTests(undefined);
});

const SETTINGS: CarrierSettings = {
  licenceRef: "LC 2024/069 001234",
  directions: ["eu_ma"],
  euZones: ["FR-69"],
  maCities: ["nador"],
  pickup: { depot: true, home: true },
  delivery: { depot: false, home: true },
  vehicle: { kind: "van", volumeM3: 20, payloadKg: 1200 },
  transitDays: { min: 3, max: 5 },
  tariff: { currency: "EUR", perKg: 250, bands: [], minimum: 2000, volumetricKgPerM3: null, items: [{ item: "e-scooter", price: 6000 }], surcharges: [] },
  refused: [],
  note: "",
};

function act(who: Member, cid: string, body: unknown): Promise<CallResult<CarrierRequestResponse & ErrorBody>> {
  return call(carrierRequestRoute, "POST", MESSAGING_API.carrierRequest(cid), { member: who, params: { cid }, body });
}

async function actOk(who: Member, cid: string, body: unknown): Promise<CarrierRequestResponse> {
  const result = await act(who, cid, body);
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body;
}

/** A carrier's departure in 5 days, its shop holding a price list. */
async function departureListing(patch: { departOn?: string; space?: "some" | "full"; subcategoryId?: string } = {}) {
  const [client, carrier] = await Promise.all([member({ displayName: "Samira Envoi" }), member({ displayName: "Rif Express" })]);
  const proId = newProId();
  const now = new Date();
  await proProfileRef(proId).set(
    proProfileToFirestore({
      ownerUid: carrier.uid,
      members: { [carrier.uid]: "owner" },
      name: "Rif Express",
      slug: `rif-express-${proId}`,
      description: "Départs chaque semaine de Lyon vers le Rif.",
      whatsapp: false,
      regionCode: "02",
      citySlug: "nador",
      sector: "carrier",
      legal: { form: "entreprise_ue", country: "FR", registry: "73282932000074" },
      kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
      lifecycle: "verified",
      plan: "essentiel",
      planSource: "launch_offer",
      quotas: DEFAULT_PRICING.pro.essentiel,
      carrier: SETTINGS,
      carrierUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const departOn = patch.departOn ?? day(5);
  const listing = await seedListing(carrier, {
    sellerType: "pro",
    proId,
    categoryId: "services",
    subcategoryId: patch.subcategoryId ?? DEPARTURE_SUBCATEGORY,
    title: "Rhône → Nador",
    attributes: { "departure-direction": "europe-maroc" },
    condition: undefined,
    price: null,
    priceNegotiable: false,
    departure: { direction: "eu_ma", departOn, depositBy: departOn, arriveFrom: departOn, arriveTo: departOn, euZones: ["FR-69"], maCities: ["nador"], space: patch.space ?? "some", spaceUpdatedAt: now },
  });
  return { client, carrier, listing };
}

const BASKET = { kg: 20, items: { "e-scooter": 1 }, pickup: true };

describe("place request on a carrier's departure", () => {
  it("sends the basket with the first message, priced as an estimate, then the carrier reserves the place", async () => {
    const { client, carrier, listing } = await departureListing();
    const started = await start(client, { listingId: listing.id, text: "Bonjour, avez-vous de la place ?", turnstileToken: "ok", carrierRequest: { basket: { kg: 20, items: { "e-scooter": 1 }, pickup: true } } });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const cid = started.body.cid;

    const seen = await thread(carrier, cid);
    expect(seen.status).toBe(200);
    // A departure shows no price: the thread's header leaves « Prix à discuter » out.
    expect(seen.body.conversation.listing.unpriced).toBe(true);
    // 20 kg × 2,50 € + scooter 60 € = 110 €; home pickup is not priced by the list.
    expect(seen.body.conversation.carrierRequest).toMatchObject({ status: "requested", requestedByMe: false, departOn: day(5), basket: { kg: 20, items: { "e-scooter": 1 }, pickup: true }, estimate: { total: 11000, currency: "EUR", onRequest: [] } });
    expect(seen.body.messages.map((message) => message.type)).toEqual(["system", "text"]);
    expect(seen.body.messages[0]).toMatchObject({ text: "⟦transport:requested⟧", carrierRequest: { event: "requested", byMe: false, basket: { kg: 20 } } });

    const id = seen.body.conversation.carrierRequest!.id;
    expectError(await act(client, cid, { action: "accept", id }), 409, "carrier_request_changed");
    const accepted = await actOk(carrier, cid, { action: "accept", id });
    expect(accepted.carrierRequest).toMatchObject({ status: "accepted", requestedByMe: false });
    const clientView = await row(client, cid);
    expect(clientView.body.conversation.carrierRequest).toMatchObject({ status: "accepted", requestedByMe: true });
    // An accepted request makes the exchange reciprocal (the review opens 24 h later).
    expect(clientView.body.conversation.review.sellerRepliedAt).not.toBeNull();
    expectError(await act(carrier, cid, { action: "decline", id }), 409, "carrier_request_changed");
    expectError(await act(client, cid, { action: "withdraw", id }), 409, "carrier_request_changed");
  });

  it("lets the client change, withdraw and ask again, and the carrier decline", async () => {
    const { client, carrier, listing } = await departureListing();
    const started = await start(client, { listingId: listing.id, text: "Bonjour", turnstileToken: "ok", carrierRequest: { basket: BASKET } });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const cid = started.body.cid;
    const changed = await actOk(client, cid, { action: "request", basket: { kg: 35, items: {} } });
    expect(changed.carrierRequest).toMatchObject({ status: "requested", basket: { kg: 35, items: {} }, estimate: { total: 8750 } });
    const withdrawn = await actOk(client, cid, { action: "withdraw", id: changed.carrierRequest.id });
    expect(withdrawn.carrierRequest.status).toBe("withdrawn");
    const again = await actOk(client, cid, { action: "request", basket: { kg: 5, items: {} } });
    // Under the 20 € minimum: the estimate is the minimum.
    expect(again.carrierRequest.estimate?.total).toBe(2000);
    const declined = await actOk(carrier, cid, { action: "decline", id: again.carrierRequest.id });
    expect(declined.carrierRequest.status).toBe("declined");
    const events = (await thread(client, cid)).body.messages.filter((message) => message.carrierRequest).map((message) => message.carrierRequest!.event);
    expect(events).toEqual(["declined", "requested", "withdrawn", "changed", "requested"]);
    // Only the client asks.
    expect((await act(carrier, cid, { action: "request", basket: { kg: 5, items: {} } })).status).toBe(403);
  });

  it("refuses an empty basket, a full or past departure and other listings before anything is written", async () => {
    const { client, listing } = await departureListing();
    expect((await start(client, { listingId: listing.id, text: "Bonjour", turnstileToken: "ok", carrierRequest: { basket: { kg: 0, items: {} } } })).status).toBe(400);
    const full = await departureListing({ space: "full" });
    expectError(await start(full.client, { listingId: full.listing.id, text: "Bonjour", turnstileToken: "ok", carrierRequest: { basket: BASKET } }), 409, "carrier_request_unavailable");
    const past = await departureListing({ departOn: day(-1) });
    expectError(await start(past.client, { listingId: past.listing.id, text: "Bonjour", turnstileToken: "ok", carrierRequest: { basket: BASKET } }), 409, "carrier_request_unavailable");
    const other = await departureListing({ subcategoryId: "demenagement-transport" });
    expectError(await start(other.client, { listingId: other.listing.id, text: "Bonjour", turnstileToken: "ok", carrierRequest: { basket: BASKET } }), 409, "carrier_request_unavailable");
    expect((await start(client, { listingId: listing.id, text: "Bonjour", turnstileToken: "ok", carrierRequest: { basket: BASKET }, offer: { amount: 100 } })).status).toBe(400);
  });
});
