import "server-only";
import mailchecker from "mailchecker";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guards";
import { displayNameFor, errorCode, userByEmail } from "@/lib/auth/accounts";
import { assertNotLocked, checkPassword, countAttempt, loginKeys } from "@/lib/auth/login";
import { sendEmailChangedMail, sendEmailChangeMail } from "@/lib/auth/mails";
import { applyDevice, deviceOf, jsonResponse, withDevice } from "@/lib/auth/respond";
import { emailChangeSchema, type EmailChangeResponse } from "@/lib/contracts/account";
import { emailNormHash, findUidByEmail, getUser, getUserPrivate, isEmailTaken, moveAccountEmail, setEmailChange } from "@/lib/db/repositories/users";
import { auth } from "@/lib/firebase/admin";
import { isStaff, readClaims } from "@/lib/firebase/claims";
import { revokeSessions } from "@/lib/firebase/session";
import { HttpError, forbidden } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { logger } from "@/lib/logging/logger";
import { removeSuppression } from "@/lib/mail/suppressions";
import { assertQuotas } from "@/lib/quota/gate";
import { enforceLimit, resetLimit } from "@/lib/rate-limit/limiter";
import { confirmVerdict, pendingEmailChange } from "./email-change-rules";

// Change of e-mail address (audit Z1-10, M2), in two steps:
//  1. POST /api/account/email: a signed-in member with a password re-authenticates (current
//     password, same lockout as the sign-in) and names the new address. A link goes to that address
//     only when no account uses it; the answer and the pending state are the same either way (no
//     enumeration). Nothing changes yet: the pending change waits 24 hours in the private document.
//  2. /action?mode=changeEmail: the link carries a Firebase VERIFY_AND_CHANGE_EMAIL code (single use,
//     expiring, generated at delivery like the other auth links). confirmEmailChange checks it
//     against the pending change, moves the Auth record, then the emailIndex and the private
//     document, revokes every session and tells the old address (new one masked). Audit-logged.
// A Google-only account has no password to re-authenticate with: 409 `password_required` (the
// settings page explains it, see the Mot de passe section).

/** Minimum duration of a request: a free address (one mail queued) and a taken one answer alike. */
const UNIFORM_REQUEST_MS = 600;

async function atLeast(startedAt: number, ms: number): Promise<void> {
  const left = startedAt + ms - Date.now();
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}

/** True when an account (Firestore index, normalized) or an Auth record (exact) already uses the address. */
async function addressTaken(email: string): Promise<boolean> {
  if (await findUidByEmail(email)) return true;
  return (await userByEmail(email)) !== null;
}

export async function handleEmailChangeRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const context = await requireUser(request, { mutation: true, checkRevoked: true });
  const input = await readJson(request, emailChangeSchema);
  const device = deviceOf(request);
  const { uid } = context.user;
  if (isStaff(context.user.claims)) throw forbidden("staff addresses are managed on the back office");
  await enforceLimit("account.email.uid", uid);
  const [record, account, profile] = await Promise.all([auth().getUser(uid), getUserPrivate(uid), getUser(uid)]);
  const currentEmail = record.email;
  if (!currentEmail || !account?.providers.includes("password")) throw new HttpError(409, "password_required");

  // Re-authentication: the sign-in's counters and lockout, the password checked for this very account.
  const keys = loginKeys(currentEmail, device.identity.ipBucket);
  await assertNotLocked(keys);
  const attempt = await countAttempt(keys);
  const checked = await checkPassword(currentEmail, input.currentPassword, keys, attempt);
  if (checked.localId !== uid) throw new HttpError(401, "invalid_credentials");
  await resetLimit("login.fail.accountIp", keys.accountIp);

  const newEmail = input.newEmail;
  if (emailNormHash(newEmail) === emailNormHash(currentEmail)) throw new HttpError(400, "same_email");
  if (!mailchecker.isValid(newEmail)) throw new HttpError(400, "disposable_email");
  await assertQuotas(["firestore.writes"]);
  await enforceLimit("account.email.target", emailNormHash(newEmail));

  const now = new Date();
  const pending = pendingEmailChange(newEmail, now);
  await setEmailChange(uid, pending);
  const taken = await addressTaken(newEmail);
  if (!taken) {
    await sendEmailChangeMail({ uid, email: newEmail, currentEmail, displayName: displayNameFor(profile, record, currentEmail), locale: profile?.locale ?? "fr", expiresAt: pending.expiresAt });
  }
  await audit({
    actorUid: uid,
    actorRole: context.user.claims.role === "pro" ? "pro" : "individual",
    action: "account.email_change_request",
    target: { type: "user", id: uid },
    automated: false,
    reason: taken ? "new address already used by an account: no link sent" : "confirmation link sent to the new address",
    ip: device.identity.ip,
    at: now,
  });
  await atLeast(startedAt, UNIFORM_REQUEST_MS);
  const body: EmailChangeResponse = { status: "pending", newEmail, expiresAt: pending.expiresAt.toISOString() };
  return applyDevice(jsonResponse(body), device);
}

/** DELETE /api/account/email: the pending change is dropped; its link no longer works. */
export async function handleEmailChangeCancel(request: Request): Promise<Response> {
  const context = await requireUser(request, { mutation: true, checkRevoked: true });
  const { uid } = context.user;
  await enforceLimit("account.mutation.uid", uid);
  await setEmailChange(uid, null);
  const body: EmailChangeResponse = { status: "cancelled" };
  return withDevice(jsonResponse(body), request);
}

/**
 * The confirmation link (POST /api/auth/action, mode changeEmail; the anonymous flow and its limits
 * are the caller's). `code` is the VERIFY_AND_CHANGE_EMAIL code as Firebase checked it, not consumed:
 * it names the account's address (`email`) and the new one. Single use: once the account has moved,
 * no account has the code's `email` any more and the pending change is gone.
 */
export async function confirmEmailChange(code: { requestType?: string; email?: string; newEmail?: string }, ip: string | undefined, now = new Date()): Promise<{ email: string }> {
  if (code.requestType !== "VERIFY_AND_CHANGE_EMAIL" || !code.email || !code.newEmail) throw new HttpError(400, "invalid_code");
  const record = await userByEmail(code.email);
  if (!record?.email) throw new HttpError(400, "invalid_code");
  if (isStaff(readClaims(record.customClaims ?? {}))) throw new HttpError(400, "invalid_code");
  if (record.disabled) throw new HttpError(403, "account_disabled");
  const uid = record.uid;
  const [account, profile] = await Promise.all([getUserPrivate(uid), getUser(uid)]);
  const verdict = confirmVerdict(code, account?.emailChange, now);
  if (!verdict.ok) throw new HttpError(400, verdict.code);
  const oldEmail = record.email;
  const newEmail = account!.emailChange!.newEmail;
  // Taken since the request (another sign-up, another change): refused before anything moves.
  const owner = await findUidByEmail(newEmail);
  if (owner && owner !== uid) throw new HttpError(409, "conflict");
  await assertQuotas(["firestore.writes"]);

  // Auth first: a refusal there (an Auth record with this address) leaves everything as it was.
  try {
    await auth().updateUser(uid, { email: newEmail, emailVerified: true });
  } catch (error) {
    if (errorCode(error) === "auth/email-already-exists") throw new HttpError(409, "conflict");
    throw error;
  }
  try {
    await moveAccountEmail(uid, newEmail, now);
  } catch (error) {
    // Firestore refused (the index taken in between, or unavailable): the Auth record goes back.
    await auth()
      .updateUser(uid, { email: oldEmail, emailVerified: true })
      .catch((cause: unknown) => logger.error({ err: (cause as Error).message, uid }, "email change: auth record not restored"));
    if (isEmailTaken(error)) throw new HttpError(409, "conflict");
    throw error;
  }

  // The address is a sign-in identifier: every session ends, the member signs in with the new one.
  await revokeSessions(uid);
  await removeSuppression(newEmail).catch((error: unknown) => logger.warn({ err: (error as Error).message }, "mail suppression removal skipped"));
  await audit({
    actorUid: uid,
    actorRole: readClaims(record.customClaims ?? {}).role === "pro" ? "pro" : "individual",
    action: "account.email_change",
    target: { type: "user", id: uid },
    automated: false,
    reason: "new address confirmed from its link; sessions revoked, old address notified",
    ...(ip ? { ip } : {}),
    at: now,
  });
  try {
    await sendEmailChangedMail({ uid, email: oldEmail, newEmail, displayName: displayNameFor(profile, record, oldEmail), locale: profile?.locale ?? "fr", at: now });
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "email change: notice to the old address not sent");
  }
  return { email: newEmail };
}
