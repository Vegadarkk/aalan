import { EMAIL_CHANGE_TTL_HOURS } from "@/lib/contracts/account";

// Change of e-mail address (audit Z1-10, M2): the pure rules the request, the confirmation link and
// the unit tests share. No server import.

export interface PendingEmailChange {
  newEmail: string;
  requestedAt: Date;
  expiresAt: Date;
}

export function pendingEmailChange(newEmail: string, now: Date): PendingEmailChange {
  return { newEmail, requestedAt: now, expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_HOURS * 3_600_000) };
}

/** The pending change still waiting for its link, or null (none, or past its expiry). */
export function livePendingChange(pending: PendingEmailChange | undefined | null, now: Date): PendingEmailChange | null {
  return pending && pending.expiresAt.getTime() > now.getTime() ? pending : null;
}

export type ConfirmVerdict = { ok: true } | { ok: false; code: "invalid_code" | "expired_code" };

/**
 * Whether a VERIFY_AND_CHANGE_EMAIL code (checked by Firebase: its type, the account's address and
 * the new one) may change this account: the code must name the change the account asked for and is
 * still waiting for. A cancelled or replaced request, or one past its 24 hours, refuses the link.
 */
export function confirmVerdict(code: { requestType?: string; newEmail?: string }, pending: PendingEmailChange | undefined | null, now: Date): ConfirmVerdict {
  if (code.requestType !== "VERIFY_AND_CHANGE_EMAIL" || !code.newEmail || !pending) return { ok: false, code: "invalid_code" };
  if (pending.newEmail.toLowerCase() !== code.newEmail.trim().toLowerCase()) return { ok: false, code: "invalid_code" };
  if (pending.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "expired_code" };
  return { ok: true };
}

/**
 * The new address as the notice to the old one shows it: the first character of the local part and
 * the domain ("n•••••@gmail.com"). The old address may no longer be its owner's: it must not learn
 * the whole new one.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const first = Array.from(local)[0] ?? "";
  return `${first}•••••${email.slice(at)}`;
}
