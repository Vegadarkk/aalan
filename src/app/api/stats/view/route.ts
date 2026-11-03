import { optionalUser, requireSameOrigin } from "@/lib/auth/guards";
import { listingIdSchema } from "@/lib/contracts/listings";
import { statsViewSchema } from "@/lib/contracts/pro";
import { readJson } from "@/lib/http/json";
import { apiRoute } from "@/lib/http/route";
import { proIdSchema } from "@/lib/pro/profile-schema";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { requestIdentity } from "@/lib/rate-limit/keys";
import { countView } from "@/lib/stats/counters";

// POST /api/stats/view: the view beacon of a listing or storefront page (cached pages, so the view
// is counted here; shop counters, UX audit of the Pro shops lot 1). Same origin, rate limited, one
// view per visitor and day (src/lib/stats/counters.ts); the shop's own views and crawlers are not
// counted. Always 204: the page never waits on it or learns anything from it.

export const dynamic = "force-dynamic";

const CRAWLER = /bot|crawl|spider|slurp|preview|headless|lighthouse/i;

export const POST = apiRoute(async (request) => {
  requireSameOrigin(request);
  const input = await readJson(request, statsViewSchema);
  const identity = requestIdentity(request.headers);
  await enforceLimit("stats.view.ip", identity.ipBucket);
  const id = (input.scope === "shop" ? proIdSchema : listingIdSchema).safeParse(input.id);
  const agent = request.headers.get("user-agent") ?? "";
  if (id.success && !CRAWLER.test(agent)) {
    const viewer = await optionalUser(request, { checkRevoked: false });
    if (!(input.scope === "shop" && viewer?.user.claims.proId === id.data)) await countView(input.scope === "shop" ? "s" : "l", id.data, identity.deviceKey);
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});
