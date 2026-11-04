import "server-only";
import { getSuspension } from "@/lib/decisions/repository";
import { verifySession } from "@/lib/firebase/session";
import { logger } from "@/lib/logging/logger";

// Why a session cookie no longer signs in, for the sign-in page (synthesis §5, zone 7 P2-4): a
// suspension revokes the sessions, and the member must not land on a bare "session ended" notice.
// Only a cookie the server itself signed is looked at (signature and expiry checked, revocation not:
// that is the point), so a forged cookie learns nothing.

export interface EndedSessionReason {
  kind: "suspended";
  /** End of the suspension. */
  until: Date;
}

export async function endedSessionReason(cookie: string | undefined, now: Date = new Date()): Promise<EndedSessionReason | null> {
  try {
    const user = await verifySession(cookie, { checkRevoked: false });
    if (!user) return null;
    const suspension = await getSuspension(user.uid);
    return suspension && suspension.until.getTime() > now.getTime() ? { kind: "suspended", until: suspension.until } : null;
  } catch (error) {
    // Fail open: the generic "session ended" notice still shows.
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "sign-in: ended session reason skipped");
    return null;
  }
}
