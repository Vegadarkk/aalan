import "server-only";
import { releasePendingVariant } from "@/lib/db/repositories/users";
import { auth } from "@/lib/firebase/admin";
import { logger } from "@/lib/logging/logger";

// The normalized e-mail (one account per person, +tags and Gmail dots folded) is reserved by a
// sign-up before its address is proven. An unproven variant must not keep the owner of the address
// out: a pending account under another exact address gives way to
// - a Google sign-up (Google proved its address), whatever the variant;
// - a password sign-up of the address without a +tag, when the pending one carries a +tag (the
//   reverse is refused: a +tag sign-up never displaces a pending sign-up of the plain address).
// An activated account always keeps the address (the sign-up gets the usual existing-account answer).

const hasTag = (email: string): boolean => {
  const at = email.lastIndexOf("@");
  return email.slice(0, at > 0 ? at : email.length).indexOf("+") > 0;
};

/** True when the pending account `uid` was removed so that this sign-up of `email` proceeds. */
export async function displacePendingVariant(uid: string, email: string, proven: boolean): Promise<boolean> {
  const yields = (holderEmail: string) => proven || (hasTag(holderEmail) && !hasTag(email.trim().toLowerCase()));
  if (!(await releasePendingVariant(uid, email, yields))) return false;
  await auth()
    .deleteUser(uid)
    .catch((error: unknown) => logger.error({ err: (error as Error).message }, "pending variant: auth record left after its documents"));
  logger.info({ proven }, "pending variant released for a new sign-up");
  return true;
}
