import "server-only";
import { randomBytes } from "node:crypto";
import { DEPARTURE_SUBCATEGORY } from "@/config/categories";
import { basketItems, carrierRequestMarker, type CarrierBasketInput, type CarrierRequestAction, type CarrierRequestEvent, type CarrierRequestResponse } from "@/lib/contracts/carrier-requests";
import { getListing, type ListingRecord } from "@/lib/db/repositories/listings";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { carrierRequestSchema, type CarrierRequestDoc, type CarrierRequestEventDoc } from "@/lib/db/schemas";
import { HttpError, notFound } from "@/lib/http/errors";
import { acceptsContact } from "@/lib/listings/public";
import { dayNumber, moroccoToday } from "@/lib/listings/rental-availability";
import { ConversationAccessError, getParticipantConversation, type ConversationRecord } from "@/lib/messaging/repository";
import { appendSystemStep, type MessagingActor } from "@/lib/messaging/service";
import { estimate } from "@/lib/carriers/estimate";
import { carrierRequestView } from "./views";

// Place request steps on a carrier's departure (transporteurs/spec.md §5). The client (the
// conversation's buyer) sends the basket, or replaces an unanswered request; the carrier (the
// seller) answers « Place réservée » or « Pas de place »; the client may withdraw an unanswered
// request. Each step is one system message appended in the message transaction (access checks of
// D4), so it reaches the other participant like a message. The request keeps the carrier's price
// list applied to the basket at that time: an estimate, never a price agreed (owner, 10 Nov 2026).

const newRequestId = () => randomBytes(9).toString("base64url");

const changed = () => new HttpError(409, "carrier_request_changed");

export type CarrierRole = "buyer" | "seller";

export interface CarrierStep {
  request: CarrierRequestDoc;
  event: CarrierRequestEvent;
}

/** What a request is about: the departure day and the estimate of the basket. */
export interface CarrierRequestContext {
  departOn: string;
  estimate?: CarrierRequestDoc["estimate"];
}

/** The basket as stored: catalogue order, counts bounded, empty options left out. */
export function storedBasket(basket: CarrierBasketInput): CarrierBasketInput {
  return {
    kg: basket.kg,
    items: Object.fromEntries(basketItems(basket)),
    ...(basket.pickup ? { pickup: true as const } : {}),
    ...(basket.delivery ? { delivery: true as const } : {}),
  };
}

/** The next state of `current` after `action` by the participant in `role` at `now`; throws when the action does not apply. */
export function nextCarrierStep(current: CarrierRequestDoc | undefined, action: CarrierRequestAction, role: CarrierRole, now: Date, context?: CarrierRequestContext): CarrierStep {
  if (action.action === "request") {
    if (role !== "buyer") throw new HttpError(403, "forbidden", "only the client asks for a place");
    if (!context) throw new Error("place request without its departure");
    const request = carrierRequestSchema.parse({
      id: newRequestId(),
      status: "requested",
      departOn: context.departOn,
      basket: storedBasket(action.basket),
      ...(context.estimate ? { estimate: context.estimate } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return { request, event: current?.status === "requested" ? "changed" : "requested" };
  }
  if (!current || current.id !== action.id || current.status !== "requested") throw changed();
  const base = { ...current, updatedAt: now };
  switch (action.action) {
    case "accept":
      if (role !== "seller") throw changed();
      if (moroccoToday(now) > dayNumber(current.departOn)) throw new HttpError(409, "carrier_request_past");
      return { request: { ...base, status: "accepted" }, event: "accepted" };
    case "decline":
      if (role !== "seller") throw changed();
      return { request: { ...base, status: "declined" }, event: "declined" };
    case "withdraw":
      if (role !== "buyer") throw changed();
      return { request: { ...base, status: "withdrawn" }, event: "withdrawn" };
  }
}

const roleOf = (conversation: Pick<ConversationRecord, "buyerUid">, uid: string): CarrierRole => (conversation.buyerUid === uid ? "buyer" : "seller");

/**
 * The departure a place request is about: a published departure that takes contact, still ahead
 * and not « Complet », else 409 `carrier_request_unavailable`.
 */
export function requestableDeparture(listing: ListingRecord | null, now: Date): NonNullable<ListingRecord["departure"]> {
  const departure = listing?.departure;
  if (!listing || !departure || listing.subcategoryId !== DEPARTURE_SUBCATEGORY || listing.status !== "published" || listing.moderation.hiddenBy || !acceptsContact(listing)) {
    throw new HttpError(409, "carrier_request_unavailable");
  }
  if (dayNumber(departure.departOn) < moroccoToday(now) || departure.space === "full") throw new HttpError(409, "carrier_request_unavailable");
  return departure;
}

/** The departure day and the carrier's price list applied to the basket (no estimate without a list). */
async function requestContext(listing: ListingRecord, basket: CarrierBasketInput, now: Date): Promise<CarrierRequestContext> {
  const departure = requestableDeparture(listing, now);
  const profile = listing.proId ? await getProProfile(listing.proId) : null;
  const tariff = profile?.carrier?.tariff;
  if (!tariff) return { departOn: departure.departOn };
  const priced = estimate(tariff, { kg: basket.kg, items: basket.items, options: { pickup: basket.pickup === true, delivery: basket.delivery === true } });
  return { departOn: departure.departOn, estimate: { total: priced.total, currency: priced.currency, onRequest: priced.onRequest } };
}

async function participantConversation(cid: string, uid: string): Promise<ConversationRecord> {
  try {
    return await getParticipantConversation(cid, uid);
  } catch (error) {
    if (error instanceof ConversationAccessError) throw notFound();
    throw error;
  }
}

/**
 * One place request step in `cid` by `actor` (the route handler authenticated, limited and gated
 * it). A request reads the conversation and its departure first (`listing` when the caller has
 * it: the first message) and prices the basket with the carrier's list.
 */
export async function actOnCarrierRequest(actor: MessagingActor, cid: string, action: CarrierRequestAction, now = new Date(), listing?: ListingRecord): Promise<CarrierRequestResponse> {
  let context: CarrierRequestContext | undefined;
  if (action.action === "request") {
    if (!listing) {
      const conversation = await participantConversation(cid, actor.uid);
      listing = (await getListing(conversation.listingId)) ?? undefined;
    }
    if (!listing) throw new HttpError(409, "carrier_request_unavailable");
    context = await requestContext(listing, action.basket, now);
  }
  let result: { request: CarrierRequestDoc; role: CarrierRole } | undefined;
  const messageId = await appendSystemStep(
    actor,
    cid,
    (conversation) => {
      const role = roleOf(conversation, actor.uid);
      // A request belongs to the conversation of its own listing.
      if (listing && listing.id !== conversation.listingId) throw new HttpError(409, "carrier_request_unavailable");
      const step = nextCarrierStep(conversation.carrierRequest, action, role, now, context);
      result = { request: step.request, role };
      const asked = step.event === "requested" || step.event === "changed";
      const carrierRequest: CarrierRequestEventDoc = {
        id: step.request.id,
        event: step.event,
        departOn: step.request.departOn,
        ...(asked ? { basket: step.request.basket } : {}),
        ...(asked && step.request.estimate ? { estimate: step.request.estimate } : {}),
      };
      return { fields: { carrierRequest: step.request }, message: { text: carrierRequestMarker(step.event), carrierRequest } };
    },
    now,
  );
  if (!result) throw new Error("place request step without a result");
  return { carrierRequest: carrierRequestView(result.request, result.role === "buyer"), messageId };
}
