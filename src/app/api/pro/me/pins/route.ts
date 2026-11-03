import { apiRoute } from "@/lib/http/route";
import { handlePins } from "@/lib/pro/handlers";

// PUT /api/pro/me/pins: the listings pinned on the storefront, replaced whole (UX audit lot 3).
export const dynamic = "force-dynamic";
export const PUT = apiRoute(handlePins);
