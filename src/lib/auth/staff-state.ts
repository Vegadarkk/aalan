// State of a roster entry (§6 "Personnel", audit zone 7 P3-5): an invited member stays pending
// until they set their password (or sign in), and the invitation link expires. Pure and
// client-safe: the /personnel table and the server share it.

/**
 * Validity of the invitation link: a Firebase Auth password reset code, generated when the mail is
 * delivered, lasts one hour (not configurable on Firebase Spark). The roster counts from the
 * invitation, so it never shows a link as valid after it expired; the mail states its own time.
 */
export const STAFF_INVITE_LINK_MINUTES = 60;

export interface StaffStateInput {
  revokedAt: string | null;
  /** Last invitation sent; absent on entries older than the pending state (active). */
  invitedAt: string | null;
  /** First password set or first sign-in after the last invitation. */
  activatedAt: string | null;
}

export type StaffState = { kind: "active" } | { kind: "revoked"; at: string } | { kind: "pending"; invitedAt: string; expiresAt: string; expired: boolean };

export function inviteExpiry(invitedAt: Date | string): Date {
  return new Date(new Date(invitedAt).getTime() + STAFF_INVITE_LINK_MINUTES * 60_000);
}

export function staffState(member: StaffStateInput, now: Date = new Date()): StaffState {
  if (member.revokedAt) return { kind: "revoked", at: member.revokedAt };
  if (!member.invitedAt || member.activatedAt) return { kind: "active" };
  const expiresAt = inviteExpiry(member.invitedAt);
  return { kind: "pending", invitedAt: member.invitedAt, expiresAt: expiresAt.toISOString(), expired: expiresAt.getTime() <= now.getTime() };
}
