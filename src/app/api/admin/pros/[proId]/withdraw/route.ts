import { requireStaff } from "@/lib/auth/guards";
import { proWithdrawSchema, type ProWithdrawResponse } from "@/lib/contracts/pro";
import { notFound } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { apiRoute, json } from "@/lib/http/route";
import { proIdSchema } from "@/lib/pro/profile-schema";
import { withdrawValidation } from "@/lib/pro/revalidation";
import { requestIdentity } from "@/lib/rate-limit/keys";
import { enforceLimit } from "@/lib/rate-limit/limiter";

// Withdraws a shop's validation (zone 7 audit P2-10, owner decision 2026-11-04): back to a new KYBC
// review, storefront hidden, listings paused, Pro claims removed. Admins only, admin host only.

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, context) => {
  const ctx = await requireStaff(request, { mutation: true, roles: ["admin"] });
  const id = proIdSchema.safeParse((await context.params)["proId"]);
  if (!id.success) throw notFound();
  await enforceLimit("pro.decision.uid", ctx.user.uid);
  const body = await readJson(request, proWithdrawSchema);
  return json<ProWithdrawResponse>(await withdrawValidation(ctx, id.data, body, requestIdentity(request.headers)));
});
