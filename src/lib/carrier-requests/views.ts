import type { CarrierRequestEventView, CarrierRequestView } from "@/lib/contracts/carrier-requests";
import type { CarrierRequestDoc, CarrierRequestEventDoc } from "@/lib/db/schemas";

// What a participant sees of the conversation's place request and of its system messages.

export function carrierRequestView(request: CarrierRequestDoc, requestedByMe: boolean): CarrierRequestView {
  return {
    id: request.id,
    status: request.status,
    requestedByMe,
    departOn: request.departOn,
    basket: request.basket,
    estimate: request.estimate ?? null,
    updatedAt: request.updatedAt.getTime(),
  };
}

export function carrierRequestEventView(step: CarrierRequestEventDoc, byMe: boolean): CarrierRequestEventView {
  return { event: step.event, byMe, departOn: step.departOn, basket: step.basket ?? null, estimate: step.estimate ?? null };
}
