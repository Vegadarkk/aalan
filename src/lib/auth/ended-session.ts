import "server-only";
import { getSuspension } from "@/lib/decisions/repository";
import { getClaims, type Claims } from "@/lib/firebase/claims";
import { verifySession } from "@/lib/firebase/session";
import { logger } from "@/lib/logging/logger";

// Why a session cookie no longer signs in, for the sign-in page (synthesis §5, zone 7 P2-4 and P4):
// a suspension revokes the sessions, and so does every change of the account's rights (claims), a
// shop's validation first among them; the member must not land on a bare "session ended" notice.
// Only a cookie the server itself signed is looked at (signature and expiry checked, revocation not:
// that is the point), so a forged cookie learns nothing.

export type EndedSessionReason =
  | {
      kind: "suspended";
      /** End of the suspension. */
      until: Date;
    }
  /** The shop was validated: the account became Pro after the cookie was signed. */
  | { kind: "pro-validated" }
  /** Another change of the account's rights (a role, a shop, the end of a suspension). */
  | { kind: "account-changed" };

const CLAIM_KEYS = ["role", "proId", "proRole", "st"] as const satisfies readonly (keyof Claims)[];

/** What a claims change says to the member, or null when the rights are the same. */
export function claimsChange(before: Claims, after: Claims): EndedSessionReason | null {
  if (CLAIM_KEYS.every((key) => before[key] === after[key])) return null;
  return after.role === "pro" && before.role !== "pro" ? { kind: "pro-validated" } : { kind: "account-changed" };
}

export async function endedSessionReason(cookie: string | undefined, now: Date = new Date()): Promise<EndedSessionReason | null> {
  try {
    const user = await verifySession(cookie, { checkRevoked: false });
    if (!user) return null;
    const suspension = await getSuspension(user.uid);
    if (suspension && suspension.until.getTime() > now.getTime()) return { kind: "suspended", until: suspension.until };
    // The cookie carries the claims it was signed with; the account holds the current ones.
    return claimsChange(user.claims, await getClaims(user.uid));
  } catch (error) {
    // Fail open: the generic "session ended" notice still shows.
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "sign-in: ended session reason skipped");
    return null;
  }
}
