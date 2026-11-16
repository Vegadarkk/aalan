import "server-only";
import { firstDegraded } from "@/lib/quota";
import { assertQuotas, MEMBER_READ_QUOTAS } from "@/lib/quota/gate";
import { consumeLimit, enforceLimit } from "./limiter";

// Reads of a member's own account data that have no document budget of their own: the session
// summary, the settings and decisions reads, upload status, Pro reads, phone status and « Mes avis ».
// They share one daily document budget per account (`member.docs.uid`, a tenth of the Spark read
// day), charged before the first read, so no loop on one of them spends the site's reads. Routes
// with their own budget (listings, conversations, favorites, saved searches) keep it.

/**
 * A read route without its own limiter: 503 once Firestore reads are degraded, then the hourly call
 * limiter and `documents` from the daily budget (429 when spent). Before the first read.
 */
export async function meterMemberRead(uid: string, documents = 1): Promise<void> {
  await assertQuotas(MEMBER_READ_QUOTAS);
  await enforceLimit("member.read.uid", uid);
  await enforceLimit("member.docs.uid", uid, documents);
}

/** `documents` from the daily budget, 429 when spent: beside a route's own hourly call limiter. */
export async function chargeMemberDocs(uid: string, documents = 1): Promise<void> {
  await enforceLimit("member.docs.uid", uid, documents);
}

/** Documents read beyond those charged up front (a list): counted, never refused. */
export async function topUpMemberDocs(uid: string, documents: number): Promise<void> {
  if (documents > 0) await consumeLimit("member.docs.uid", uid, documents);
}

/**
 * The session summary's form: false once reads are degraded or the account's hour or day is spent,
 * and the caller answers from the cookie's claims instead of Firestore. A limiter that cannot answer
 * lets the read through (open policy).
 */
export async function memberReadAllowed(uid: string, documents: number): Promise<boolean> {
  if (await firstDegraded(MEMBER_READ_QUOTAS)) return false;
  const calls = await consumeLimit("member.read.uid", uid);
  if (!calls.ok && calls.reason === "limited") return false;
  const docs = await consumeLimit("member.docs.uid", uid, documents);
  return docs.ok || docs.reason !== "limited";
}
