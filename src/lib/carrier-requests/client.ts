import { apiPost } from "@/lib/auth/client";
import type { CarrierRequestAction, CarrierRequestResponse } from "@/lib/contracts/carrier-requests";
import { MESSAGING_API } from "@/lib/contracts/endpoints";

// Browser side of POST /api/conversations/{cid}/carrier-request (CSRF header, lib/auth/client).

export function postCarrierRequestAction(cid: string, action: CarrierRequestAction): Promise<CarrierRequestResponse> {
  return apiPost<CarrierRequestResponse>(MESSAGING_API.carrierRequest(cid), action);
}
