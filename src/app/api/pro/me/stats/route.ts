import { apiRoute } from "@/lib/http/route";
import { handleStats } from "@/lib/pro/handlers";

// GET /api/pro/me/stats: the shop's counters of the last 7 and 30 days (UX audit of the Pro shops, lot 1).
export const dynamic = "force-dynamic";
export const GET = apiRoute(handleStats);
