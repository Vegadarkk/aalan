import { apiRoute } from "@/lib/http/route";
import { handleDepartureCreate, handleDepartures } from "@/lib/carriers/handlers";

// GET /api/pro/departures, POST /api/pro/departures: a carrier's departures (« Mes départs »).
export const dynamic = "force-dynamic";
export const GET = apiRoute(handleDepartures);
export const POST = apiRoute(handleDepartureCreate);
