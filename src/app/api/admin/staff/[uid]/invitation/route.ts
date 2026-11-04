import { z } from "@/lib/zod";
import { requireStaff } from "@/lib/auth/guards";
import { resendInvitation, type StaffResendResponse } from "@/lib/auth/staff";
import { notFound } from "@/lib/http/errors";
import { apiRoute, json } from "@/lib/http/route";
import { requestIdentity } from "@/lib/rate-limit/keys";

/** One Firestore document id, never a path: a slash would address a document of a subcollection. */
const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

// Resend the invitation of a member still pending (admins only, audit zone 7 P3-5).
export const POST = apiRoute(async (request, context) => {
  const ctx = await requireStaff(request, { mutation: true, roles: ["admin"] });
  const uid = uidSchema.safeParse((await context.params)["uid"]);
  if (!uid.success) throw notFound();
  return json<StaffResendResponse>(await resendInvitation(ctx, uid.data, requestIdentity(request.headers)));
});
