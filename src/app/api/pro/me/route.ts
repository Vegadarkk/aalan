import { apiRoute } from "@/lib/http/route";
import { handleMe, handleShopCard } from "@/lib/pro/handlers";

// GET /api/pro/me: the signed-in account's shop or application (phase 7 design §4).
// PUT /api/pro/me: the shop card shown on its storefront (UX audit of the Pro shops, lot 1).
export const dynamic = "force-dynamic";
export const GET = apiRoute(handleMe);
export const PUT = apiRoute(handleShopCard);
