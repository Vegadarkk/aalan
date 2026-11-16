import "server-only";
import { enforceLimit } from "./limiter";

// Successful sign-ins per account (password or Google), counted once the credential is proven and
// before the session: each writes a connection log, and the sign-out of that session another (a
// sign-out logs only for a live session, so it is bounded by the sign-ins). 429 past the hour or day.
export async function enforceSignInBudget(uid: string): Promise<void> {
  await enforceLimit("login.success.uid", uid);
  await enforceLimit("login.success.day.uid", uid);
}
