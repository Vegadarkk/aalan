import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { getUserRecord } from "@/lib/db/repositories/profiles";

/**
 * Why a held listing must not be approved now, whoever approves it (a moderator from the queue or
 * the moderation agent), or null. A suspended or closed seller's listing would be invisible and its
 * seller mailed "now visible" (audit zone 7 P2-5); a shop whose validation was withdrawn has its
 * listings paused until the new KYBC validation, so one still held at that time stays held.
 * Refusing a held listing stays possible either way. With `tx`, read inside that transaction (before
 * its writes), so a suspension or withdrawal racing the approval is seen.
 */
export async function approvalBlocker(listing: { ownerUid: string; proId?: string | null }, tx?: Transaction): Promise<"account_suspended" | "pro_revalidation" | null> {
  const owner = await getUserRecord(listing.ownerUid, tx);
  if (!owner || owner.status !== "active") return "account_suspended";
  if (listing.proId) {
    const shop = await getProProfile(listing.proId, tx);
    if (shop?.lifecycle === "revalidation_required") return "pro_revalidation";
  }
  return null;
}
