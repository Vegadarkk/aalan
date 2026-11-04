import "server-only";
import { cguAccepted, cguEffectiveFor } from "@/config/legal-versions";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guards";
import { CGU_VERSION, consentsRequestSchema, type ConsentsResponse } from "@/lib/contracts/auth";
import { getUserPrivate, recordCguNotice, updateCguConsent } from "@/lib/db/repositories/users";
import { readJson } from "@/lib/http/json";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { jsonResponse, withDevice } from "./respond";

// CGU acceptance after a change (D11) and the change notice (CGU §22.1). The transfers outside
// Morocco are no longer a consent (contract necessity, loi 09-08 art. 44 pt 4; audit B2): nothing
// asks for or renews one, and the consents.transfers records of older accounts stay as they are.

/**
 * `{ cguNotice: true }`: the change notice was shown to this member. The first notice of a version
 * is recorded (consents.cguNotice, CGU §22.1), later ones change nothing; the answer gives the day
 * the version applies to the member.
 */
async function cguNoticeShown(uid: string, now: Date): Promise<ConsentsResponse> {
  const account = await getUserPrivate(uid);
  const notice = account?.consents.cguNotice;
  const pending = account !== null && !cguAccepted(account.consents.cgu.version);
  if (pending && notice?.version !== CGU_VERSION) await recordCguNotice(uid, CGU_VERSION, now);
  const noticeAt = notice?.version === CGU_VERSION ? notice.at : pending ? now : null;
  return { status: "recorded", version: CGU_VERSION, effective: cguEffectiveFor(noticeAt, now) };
}

/**
 * POST /api/auth/consents `{ cgu: true }` (CGU change notice acknowledged, D11) or
 * `{ cguNotice: true }` (the notice shown): only that field changes,
 * the uid comes from the session. A suspended member may send them too: they open nothing the
 * suspension closes.
 */
export async function handleConsents(request: Request): Promise<Response> {
  const context = await requireUser(request, { mutation: true, allowSuspended: true });
  const choice = await readJson(request, consentsRequestSchema);
  const { uid } = context.user;
  await enforceLimit("consents.uid", uid);
  const now = new Date();
  if ("cguNotice" in choice) return withDevice(jsonResponse(await cguNoticeShown(uid, now)), request);
  const version = CGU_VERSION;
  await updateCguConsent(uid, version, now);
  // The uid and the version are the proof: no IP, no e-mail in the entry.
  await audit({
    actorUid: uid,
    actorRole: context.user.claims.role ?? "individual",
    action: "consent.cgu",
    target: { type: "user", id: uid },
    automated: false,
    reason: `version ${version}`,
    at: now,
  });
  const body: ConsentsResponse = { status: "recorded", version };
  return withDevice(jsonResponse(body), request);
}
