import { apiRoute } from "@/lib/http/route";
import { handleDepartureSpace } from "@/lib/carriers/handlers";

// PUT /api/pro/departures/{id}/space: the room left on a departure, one tap.
export const dynamic = "force-dynamic";
export const PUT = apiRoute((request, context) => handleDepartureSpace(request, context.params));
