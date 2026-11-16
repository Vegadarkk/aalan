import "server-only";
import { requireUser } from "@/lib/auth/guards";
import { profileSchema, type ProfileResponse } from "@/lib/contracts/auth";
import { getUser, updateDisplayName, updateLocale } from "@/lib/db/repositories/users";
import { auth } from "@/lib/firebase/admin";
import { readJson } from "@/lib/http/json";
import { meterAccountWrite } from "@/lib/rate-limit/account-writes";
import { jsonResponse, withDevice } from "./respond";
import { sessionSummary } from "./summary";

// Profile settings of the signed-in person only: the uid comes from the session, never from the body.
// A value equal to the stored one is not written again.

export async function handleProfile(request: Request): Promise<Response> {
  const context = await requireUser(request, { mutation: true });
  const input = await readJson(request, profileSchema);
  const { uid } = context.user;
  await meterAccountWrite(uid, "account");
  const profile = await getUser(uid);
  if (input.displayName !== undefined && input.displayName !== profile?.displayName) {
    await updateDisplayName(uid, input.displayName);
    await auth().updateUser(uid, { displayName: input.displayName });
  }
  if (input.locale !== undefined && input.locale !== profile?.locale) await updateLocale(uid, input.locale);
  const body: ProfileResponse = { session: await sessionSummary(context.user) };
  return withDevice(jsonResponse(body), request);
}
