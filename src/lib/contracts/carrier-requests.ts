import { CARRIER_ITEM_IDS, CARRIER_SEARCH, type CarrierCurrency, type CarrierItem } from "@/config/carriers";
import { basketIsEmpty, type CarrierRequestEvent, type CarrierRequestStatus } from "@/lib/carrier-requests/rules";
import { z } from "@/lib/zod";

// Place requests on a carrier's departure (transporteurs/spec.md §5): the client asks for room with
// the basket (with the first message or from the thread); the carrier answers « Place réservée »
// or « Pas de place »; the client may withdraw an unanswered request or send another one. One
// current request per conversation, carried by the conversation document; every step is a system
// message of the thread. The estimate it shows is the carrier's price list applied to the basket
// at the time of the request: informative, the carrier weighs before pickup (owner, 10 Nov 2026).

export * from "@/lib/carrier-requests/rules";

export const carrierRequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);

const itemCount = z.number().int().min(1).max(CARRIER_SEARCH.itemMax);

export const carrierBasketSchema = z
  .object({
    kg: z.number().int().min(0).max(CARRIER_SEARCH.kgMax),
    items: z.partialRecord(z.enum(CARRIER_ITEM_IDS as [CarrierItem, ...CarrierItem[]]), itemCount),
    pickup: z.literal(true).optional(),
    delivery: z.literal(true).optional(),
  })
  .strict()
  .refine((basket) => !basketIsEmpty(basket), { message: "empty_basket", path: ["kg"] });
export type CarrierBasketInput = z.infer<typeof carrierBasketSchema>;

/** The client's request, with the first message or from the thread. */
export const carrierRequestInputSchema = z.object({ basket: carrierBasketSchema }).strict();
export type CarrierRequestInput = z.infer<typeof carrierRequestInputSchema>;

export const carrierRequestActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), basket: carrierBasketSchema }).strict(),
  z.object({ action: z.literal("accept"), id: carrierRequestIdSchema }).strict(),
  z.object({ action: z.literal("decline"), id: carrierRequestIdSchema }).strict(),
  z.object({ action: z.literal("withdraw"), id: carrierRequestIdSchema }).strict(),
]);
export type CarrierRequestAction = z.infer<typeof carrierRequestActionSchema>;

/** The carrier's price list applied to the basket when it was sent. */
export interface CarrierRequestEstimate {
  /** Minor units of `currency`. */
  total: number;
  currency: CarrierCurrency;
  /** Items the list does not price: « sur devis ». */
  onRequest: CarrierItem[];
}

/** The conversation's current request as its participant sees it. */
export interface CarrierRequestView {
  id: string;
  status: CarrierRequestStatus;
  /** I am the client (the conversation's buyer). */
  requestedByMe: boolean;
  /** The departure day, "YYYY-MM-DD". */
  departOn: string;
  basket: CarrierBasketInput;
  estimate: CarrierRequestEstimate | null;
  updatedAt: number;
}

/** The request step a system message of the thread shows. */
export interface CarrierRequestEventView {
  event: CarrierRequestEvent;
  /** I took that step. */
  byMe: boolean;
  departOn: string;
  /** On a request or a change only. */
  basket: CarrierBasketInput | null;
  estimate: CarrierRequestEstimate | null;
}

/** POST /api/conversations/{cid}/carrier-request -> 201. */
export interface CarrierRequestResponse {
  carrierRequest: CarrierRequestView;
  messageId: string;
}
