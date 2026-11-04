import "server-only";
import { actionSchema, type ActionResponse } from "@/lib/contracts/auth";
import { getUserPrivate } from "@/lib/db/repositories/users";
import { auth } from "@/lib/firebase/admin";
import { isStaff, readClaims } from "@/lib/firebase/claims";
import { applyEmailVerificationCode, verifyPasswordResetCode, type OobResult } from "@/lib/firebase/rest";
import { createSessionForUid } from "@/lib/firebase/session";
import { HttpError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { logConnection } from "@/lib/logging/connection-logs";
import { logger } from "@/lib/logging/logger";
import { removeSuppression } from "@/lib/mail/suppressions";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { pepperedHash, safeEqual } from "@/lib/security/hash";
import { userByEmail, withCodeErrors } from "./accounts";
import { activateMember } from "./activation";
import { anonymous, beginAnonymous, finish, respond, type AnonymousFlow } from "./anonymous";
import { passwordGate, recordFailure, verifyPassword } from "./login";
import { signedIn } from "./respond";
import { sessionSummary } from "./summary";

// /action links of our mails (§6): the verification code activates the account (role "individual")
// and signs the person in. On the device that signed up the link alone is enough; on any other
// device the code is only applied once the account password is given (audit A-1). A reset code is
// only checked here, the new password goes to /api/auth/password/confirm.

async function uidOf(result: OobResult): Promise<string> {
  if (result.localId) return result.localId;
  const record = result.email ? await userByEmail(result.email) : null;
  if (!record) throw new HttpError(400, "invalid_code");
  return record.uid;
}

/** The e-mail of a PASSWORD_RESET code, without consuming it. */
export async function checkResetCode(oobCode: string): Promise<string> {
  const result = await withCodeErrors(() => verifyPasswordResetCode(oobCode));
  if ((result.requestType && result.requestType !== "PASSWORD_RESET") || !result.email) throw new HttpError(400, "invalid_code");
  return result.email;
}

/**
 * The e-mail of a VERIFY_EMAIL code, without consuming it: accounts:resetPassword with the code
 * alone answers the type and the e-mail of any action code (the Firebase SDK's checkActionCode, the
 * emulator's resetPassword without newPassword), and applies nothing.
 */
export async function checkVerificationCode(oobCode: string): Promise<{ email: string; uid: string }> {
  const result = await withCodeErrors(() => verifyPasswordResetCode(oobCode));
  if (result.requestType !== "VERIFY_EMAIL" || !result.email) throw new HttpError(400, "invalid_code");
  return { email: result.email, uid: await uidOf(result) };
}

/**
 * True when the request carries the device cookie of the sign-up (its hash is in the private
 * document). A link clicked from another device needs the account password: a sign-up made by
 * someone else with this address would otherwise become a verified account whose password that
 * person chose (pre-account takeover, audit A-1).
 */
async function signedUpFromThisDevice(uid: string, deviceId: string | null): Promise<boolean> {
  if (!deviceId) return false;
  const account = await getUserPrivate(uid);
  return Boolean(account?.signupDeviceHash && safeEqual(account.signupDeviceHash, pepperedHash("did", deviceId)));
}

/**
 * Another device: the account password, with the login protections (lock, Turnstile, counters).
 * Null: Turnstile is required first. The password must sign in the account of the code's e-mail.
 */
async function checkAccountPassword(flow: AnonymousFlow, request: Request, uid: string, email: string, password: string, turnstileToken: string | undefined): Promise<boolean> {
  const keys = await passwordGate(flow, request, email, turnstileToken);
  if (!keys) return false;
  const { attempt, localId } = await verifyPassword(email, password, keys);
  const record = await auth().getUser(localId);
  // Staff accounts never verify from the public host; same answer as a wrong password (login).
  if (localId !== uid || isStaff(readClaims(record.customClaims ?? {}))) {
    await recordFailure(keys, attempt);
    throw new HttpError(401, "invalid_credentials");
  }
  return true;
}

async function action(request: Request): Promise<Response> {
  const flow = beginAnonymous(request);
  const input = await readJson(request, actionSchema);
  await enforceLimit("action.ip", flow.identity.ipBucket);

  if (input.mode === "resetPassword") {
    const email = await checkResetCode(input.oobCode);
    return respond<ActionResponse>(flow, { status: "reset_ok", email });
  }

  // Read first, applied only once the device or the password says the account is this person's.
  const { email, uid } = await checkVerificationCode(input.oobCode);
  // The address just proved it receives our mail: a bounce or complaint suppression no longer holds.
  await removeSuppression(email).catch((error: unknown) => logger.warn({ err: (error as Error).message }, "mail suppression removal skipped"));
  const record = await auth().getUser(uid);
  if (record.disabled) throw new HttpError(403, "account_disabled");
  if (!(await signedUpFromThisDevice(uid, flow.identity.deviceId))) {
    // The link holder owns the mailbox: the e-mail is theirs to see (and fills the sign-in field).
    if (!input.password) return respond<ActionResponse>(flow, { status: "password_required", email });
    if (!(await checkAccountPassword(flow, request, uid, email, input.password, input.turnstileToken))) return respond<ActionResponse>(flow, { status: "turnstile_required" });
  }

  await withCodeErrors(() => applyEmailVerificationCode(input.oobCode));
  const claims = readClaims(record.customClaims ?? {});
  if (!(await activateMember(uid, claims))) return respond<ActionResponse>(flow, { status: "verified", session: null });
  const minted = await createSessionForUid(uid);
  // The verification link opens a 14-day session: a sign-in for connectionLogs like any other.
  await logConnection({ uid, event: "login", ip: flow.identity.ip });
  const body: ActionResponse = { status: "verified", session: await sessionSummary(minted.user) };
  return finish(flow, signedIn(minted, body));
}

export const handleAction = anonymous(action);
