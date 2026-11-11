import { CARRIER_ITEM_IDS, CARRIER_SEARCH, type CarrierItem } from "@/config/carriers";
import { dayNumber } from "@/lib/listings/rental-availability";

// Place requests on a carrier's departure (transporteurs/spec.md §5, « Demander une place »): the
// client sends the basket with the first message or from the thread; the carrier answers « Place
// réservée » or « Pas de place » on the request card; the client may withdraw an unanswered request
// or send another one. Nothing is booked or paid through the site: the price stays an estimate,
// set by the carrier after the control weighing before pickup (owner, 10 Nov 2026). Pure and
// zod-free: the listing page's islands import them (contracts/carrier-requests.ts re-exports them).

export const CARRIER_REQUEST_STATUSES = ["requested", "accepted", "declined", "withdrawn"] as const;
export type CarrierRequestStatus = (typeof CARRIER_REQUEST_STATUSES)[number];

/** What a system message of the thread says about the request. */
export const CARRIER_REQUEST_EVENTS = ["requested", "changed", "accepted", "declined", "withdrawn"] as const;
export type CarrierRequestEvent = (typeof CARRIER_REQUEST_EVENTS)[number];

/** The client's shipment: loose kilograms, catalogue items, home pickup and delivery. */
export interface CarrierBasket {
  kg: number;
  items: Partial<Record<CarrierItem, number>>;
  pickup?: boolean;
  delivery?: boolean;
}

/** Stored text of a request system message: the UI renders it localized (inbox preview too). */
export const carrierRequestMarker = (event: CarrierRequestEvent) => `⟦transport:${event}⟧`;
const MARKER = /^⟦transport:([a-z_]+)⟧$/;

/** The event of a request marker text, else null. */
export function carrierRequestEventOf(text: string): CarrierRequestEvent | null {
  const event = MARKER.exec(text)?.[1];
  return (CARRIER_REQUEST_EVENTS as readonly string[]).includes(event ?? "") ? (event as CarrierRequestEvent) : null;
}

/** The basket's items in catalogue order, counts between 1 and the search's maximum. */
export function basketItems(basket: Pick<CarrierBasket, "items">): [CarrierItem, number][] {
  return CARRIER_ITEM_IDS.flatMap((item) => {
    const count = basket.items[item] ?? 0;
    return count > 0 ? [[item, Math.min(count, CARRIER_SEARCH.itemMax)] as [CarrierItem, number]] : [];
  });
}

/** A basket says what is sent: some kilograms or one item at least. */
export function basketIsEmpty(basket: Pick<CarrierBasket, "kg" | "items">): boolean {
  return basket.kg <= 0 && basketItems(basket).length === 0;
}

/** The request card stays pinned in the thread until the departure day has passed. */
export function carrierRequestOpen(request: { status: CarrierRequestStatus; departOn: string }, today: number): boolean {
  return (request.status === "requested" || request.status === "accepted") && dayNumber(request.departOn) >= today;
}
