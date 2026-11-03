import { apiRoute } from "@/lib/http/route";
import { handleStartShop } from "@/lib/messaging/handlers";

// POST /api/shops/{proId}/conversations: a first message to a shop from its storefront, about no
// listing (UX audit of the Pro shops, lot 1); the thread then lives under /api/conversations/{cid}.
export const dynamic = "force-dynamic";
export const POST = apiRoute(async (request, context) => handleStartShop(request, (await context.params)["proId"]));
