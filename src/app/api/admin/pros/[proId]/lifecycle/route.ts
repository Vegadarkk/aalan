import { requireStaff } from "@/lib/auth/guards";
import { proLifecycleActionSchema, type ProLifecycleResponse } from "@/lib/contracts/pro";
import { notFound } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { apiRoute, json } from "@/lib/http/route";
import { proIdSchema } from "@/lib/pro/profile-schema";
import { proStaffAction } from "@/lib/pro/staff-actions";
import { requestIdentity } from "@/lib/rate-limit/keys";
import { enforceLimit } from "@/lib/rate-limit/limiter";

// A validated shop's record in the back office (zone 7 audit P2-10): a staff note, or the
// correction of its activity with a reason, both journaled. Moderators and admins, admin host only.

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request, context) => {
  const ctx = await requireStaff(request, { mutation: true, roles: ["moderator", "admin"] });
  const id = proIdSchema.safeParse((await context.params)["proId"]);
  if (!id.success) throw notFound();
  await enforceLimit("pro.decision.uid", ctx.user.uid);
  const body = await readJson(request, proLifecycleActionSchema);
  return json<ProLifecycleResponse>(await proStaffAction(ctx, id.data, body, requestIdentity(request.headers)));
});
