import { handleCarrierRequest } from "@/lib/carrier-requests/handlers";
import { apiRoute } from "@/lib/http/route";

// POST /api/conversations/{cid}/carrier-request: request, accept, decline or withdraw a place on a carrier's departure (transporteurs/spec.md §5).
export const dynamic = "force-dynamic";
export const POST = apiRoute((request, context) => handleCarrierRequest(request, context.params));
