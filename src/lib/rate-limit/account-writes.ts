import "server-only";
import { ACCOUNT_WRITE_QUOTAS, assertQuotas } from "@/lib/quota/gate";
import { enforceLimit } from "./limiter";

// Writes of a member's own settings: the hourly limiter of the family, its daily sibling (a small
// share of the Spark day's writes per account) and the write gate (503 once Firestore writes are
// degraded). The handlers also skip a write that would change nothing.

const FAMILIES = {
  account: ["account.mutation.uid", "account.mutation.day.uid"],
  tutorials: ["tutorials.uid", "tutorials.day.uid"],
  consents: ["consents.uid", "consents.day.uid"],
} as const;

export type AccountWriteFamily = keyof typeof FAMILIES;

/** Before the handler's first write (and read): 429 past either window, 503 with writes degraded. */
export async function meterAccountWrite(uid: string, family: AccountWriteFamily): Promise<void> {
  const [hourly, daily] = FAMILIES[family];
  await enforceLimit(hourly, uid);
  await enforceLimit(daily, uid);
  await assertQuotas(ACCOUNT_WRITE_QUOTAS);
}
