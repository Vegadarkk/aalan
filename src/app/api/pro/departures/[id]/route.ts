import { apiRoute } from "@/lib/http/route";
import { handleDepartureEdit } from "@/lib/carriers/handlers";

// PUT /api/pro/departures/{id}: new facts of a carrier's departure.
export const dynamic = "force-dynamic";
export const PUT = apiRoute((request, context) => handleDepartureEdit(request, context.params));
