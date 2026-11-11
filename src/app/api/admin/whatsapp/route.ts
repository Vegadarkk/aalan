import { audit } from "@/lib/audit";
import { requireStaff } from "@/lib/auth/guards";
import { readJson } from "@/lib/http/json";
import { apiRoute, json } from "@/lib/http/route";
import { completeMetaSignup, metaSignupRequestSchema, type MetaSignupResult } from "@/lib/phone-verify/meta-signup";
import { requestIdentity } from "@/lib/rate-limit/keys";

// Linking Aalan's WhatsApp number (Embedded Signup, src/lib/phone-verify/meta-signup.ts): admins
// only, journaled (`whatsapp.linked`). The signup code lives 30 seconds: the page posts it at once.

export const POST = apiRoute(async (request) => {
  const ctx = await requireStaff(request, { mutation: true, roles: ["admin"] });
  const body = await readJson(request, metaSignupRequestSchema);
  const result = await completeMetaSignup(body);
  await audit({
    actorUid: ctx.user.uid,
    actorRole: ctx.role,
    action: "whatsapp.linked",
    target: { type: "config", id: "whatsapp" },
    automated: false,
    reason: `account ${result.wabaId}; numbers ${result.numbers.map((number) => number.id).join(", ") || "none"}; subscribed ${result.subscribed}`.slice(0, 500),
    ip: requestIdentity(request.headers).ip,
  });
  return json<MetaSignupResult>(result);
});
