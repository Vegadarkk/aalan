import { requireUser } from "@/lib/auth/guards";
import { applyDevice, applyTurnstilePass, deviceOf, jsonResponse } from "@/lib/auth/respond";
import { turnstileTokenSchema } from "@/lib/contracts/auth";
import { notFound } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { apiRoute } from "@/lib/http/route";
import { proIdSchema } from "@/lib/pro/profile-schema";
import { revealShopPhone } from "@/lib/pro/shop-phone";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { z } from "@/lib/zod";

// POST /api/shops/{proId}/phone: the shop's verified number from its storefront, under the listing
// reveal rules (UX audit of the Pro shops, lot 1; no-store, never cached).

export const dynamic = "force-dynamic";

const revealSchema = z.object({ turnstileToken: turnstileTokenSchema.optional() }).strict();

export const POST = apiRoute(async (request, context) => {
  const auth = await requireUser(request, { mutation: true });
  const id = proIdSchema.safeParse((await context.params)["proId"]);
  if (!id.success) throw notFound();
  const input = request.headers.get("content-type") ? await readJson(request, revealSchema) : {};
  await enforceLimit("reveal.call.uid", auth.user.uid);
  const device = deviceOf(request);
  const outcome = await revealShopPhone(auth, request, id.data, { turnstileToken: input.turnstileToken, device });
  const response = applyDevice(jsonResponse(outcome.response), device);
  return outcome.turnstilePassed ? applyTurnstilePass(response, device) : response;
});
