import { apiRoute } from "@/lib/http/route";
import { handleCarrier } from "@/lib/pro/handlers";

// PUT /api/pro/me/carrier: a Europe–Morocco carrier's settings and price list (transporteurs/spec.md §3).
export const dynamic = "force-dynamic";
export const PUT = apiRoute(handleCarrier);
