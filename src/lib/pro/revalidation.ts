import "server-only";
import { audit } from "@/lib/audit";
import type { StaffContext } from "@/lib/auth/guards";
import { PRO_NOTES_KEPT, type ProWithdrawInput, type ProWithdrawResponse } from "@/lib/contracts/pro";
import { listOwnerListingsByStatus, type ListingRecord } from "@/lib/db/repositories/listings";
import { getProProfile, proProfileRef, proProfileToFirestore, type ProProfileRecord } from "@/lib/db/repositories/pro-profiles";
import { getStaff } from "@/lib/db/repositories/staff";
import { changeListings, lifetime, SANCTION_LISTINGS_MAX, undoQuietly } from "@/lib/decisions/sanctions";
import { db } from "@/lib/firebase/admin";
import { getClaims, setClaims, updateClaims } from "@/lib/firebase/claims";
import { HttpError, notFound } from "@/lib/http/errors";
import { getLegalConfig } from "@/lib/legal/config";
import { storefrontSegment } from "@/lib/listings/public";
import { transition as listingTransition } from "@/lib/listings/lifecycle";
import { revalidateListingPaths } from "@/lib/listings/revalidate";
import { logger } from "@/lib/logging/logger";
import { sendMail } from "@/lib/mail";
import { listingRecipient } from "@/lib/mail/recipients";
import { consume } from "@/lib/quota";
import type { RequestIdentity } from "@/lib/rate-limit/keys";
import { adsEligibleOf } from "@/lib/reports";
import { resetDirectoryShopsCache } from "./directory";
import { IllegalProTransitionError, transition } from "./lifecycle";
import type { ProProfileDoc } from "./profile-schema";

// Validation withdrawn (zone 7 audit P2-10, owner decision 2026-11-04: « Retour en vérification »).
// An admin sends a validated shop back to a new KYBC review: lifecycle `revalidation_required`
// (the state held is kept in `revalidationFrom`, the plan and its source untouched: no money is
// moved), the statement mailed to the Pro and shown in their space, the internal note on the
// record and in the audit log. Like a sanction (src/lib/decisions/sanctions.ts), the Auth side
// (the Pro claims removed, sessions revoked) runs before the profile transaction and is undone if
// it fails; then the published listings are paused (`pausedReason: "pro_revalidation"`, out of
// search), the storefront and directory refreshed. The account keeps `users.type = "pro"`, so it
// publishes nothing meanwhile (no Pro plan, src/lib/listings/service.ts sellerOf). The next KYBC
// validation (src/lib/pro/review.ts) restores the state, the claims and the paused listings.

/** Rounds of SANCTION_LISTINGS_MAX listings one withdrawal or restore walks at most. */
export const REVALIDATION_LISTING_ROUNDS = 10;

type Note = NonNullable<ProProfileDoc["staffNotes"]>[number];

/** The profile after the withdrawal: pure, so the unit tests cover every branch without Firestore. */
export function withdrawnProfile(current: ProProfileRecord, input: ProWithdrawInput, note: Omit<Note, "text">): ProProfileDoc {
  if (current.kybc.status !== "verified" || current.lifecycle !== input.lifecycle) throw new HttpError(409, "conflict", "the shop is not in the state the page showed");
  let patch;
  try {
    ({ patch } = transition(current, { type: "validation_withdrawn" }, { now: note.at, graceDays: 0 }));
  } catch (error) {
    if (error instanceof IllegalProTransitionError) throw new HttpError(409, "conflict", error.message);
    throw error;
  }
  const { proId: _proId, ...doc } = current;
  const text = `Validation retirée, nouvelle vérification demandée. ${input.note}`.slice(0, 500);
  return {
    ...doc,
    lifecycle: patch.lifecycle,
    plan: patch.plan,
    planSource: patch.planSource,
    revalidationFrom: patch.revalidationFrom ?? undefined,
    kybc: { ...doc.kybc, status: "withdrawn", withdrawnAt: note.at, withdrawReason: input.statement, rejectReason: undefined },
    staffNotes: [{ ...note, text }, ...(current.staffNotes ?? [])].slice(0, PRO_NOTES_KEPT),
    effectsPendingSince: undefined,
    updatedAt: note.at,
  };
}

/** POST /api/admin/pros/{proId}/withdraw (admins): the validation withdrawn, journaled, the Pro told. */
export async function withdrawValidation(staff: StaffContext, proId: string, input: ProWithdrawInput, identity: RequestIdentity, now = new Date()): Promise<ProWithdrawResponse> {
  const known = await getProProfile(proId);
  if (!known) throw notFound();
  // Fails fast before touching Auth; the transaction checks again.
  withdrawnProfile(known, input, { at: now, by: staff.user.uid, byName: "-" });
  const member = await getStaff(staff.user.uid);
  const byName = member?.displayName ?? staff.accessEmail;
  const uid = known.ownerUid;

  // Auth first (the decisions pattern): the Pro role and the shop leave the claims, `st` stays.
  const before = await getClaims(uid);
  await updateClaims(uid, { role: "individual", proId: null, proRole: null });
  let doc: ProProfileDoc;
  try {
    doc = await db().runTransaction(async (tx) => {
      const current = await getProProfile(proId, tx);
      if (!current) throw notFound();
      if (current.ownerUid !== uid) throw new HttpError(409, "conflict", "owner changed");
      const next = withdrawnProfile(current, input, { at: now, by: staff.user.uid, byName });
      tx.set(proProfileRef(proId), proProfileToFirestore(next));
      return next;
    });
  } catch (error) {
    await undoQuietly(() => setClaims(uid, before), { proId, step: "withdraw" });
    throw error;
  }
  void consume("firestore.reads", 2);
  void consume("firestore.writes", 1);

  const paused = await pauseListingsForRevalidation(uid, now);
  revalidateListingPaths({ shopSegment: storefrontSegment(known.slug, proId) });
  resetDirectoryShopsCache();
  await audit({
    actorUid: staff.user.uid,
    actorRole: staff.role,
    action: "pro.validation.withdraw",
    target: { type: "pro", id: proId },
    automated: false,
    reason: `${input.lifecycle} -> revalidation_required, ${paused.length} listings paused. Note: ${input.note} Statement: ${input.statement}`.slice(0, 500),
    ip: identity.ip,
    at: now,
  });
  await notifyWithdrawal(doc, proId, input.statement, now);
  return { proId, lifecycle: "revalidation_required", paused: paused.length };
}

/**
 * The listings the withdrawal takes offline: the published ones paused, and those an account
 * suspension paused moved under the revalidation (its lift must not republish a shop under review;
 * the new validation needs an active account, so it brings them all back). Returns their ids.
 */
export async function pauseListingsForRevalidation(uid: string, now: Date): Promise<string[]> {
  const life = await lifetime();
  const ids: string[] = [];
  // Each round takes the published listings left: the paused ones leave the query.
  for (let round = 0; round < REVALIDATION_LISTING_ROUNDS; round += 1) {
    const listings = await listOwnerListingsByStatus(uid, ["published"], SANCTION_LISTINGS_MAX);
    const changes = await changeListings(
      listings,
      (listing) => {
        if (listing.status !== "published") return null;
        const { patch } = listingTransition(listing, "paused", { now, lifetime: life, pausedReason: "pro_revalidation" });
        return { patch: { ...patch, adsEligible: false }, search: "delete" };
      },
      now,
      "revalidation pause",
    );
    ids.push(...changes.map((change) => change.listing.id));
    if (listings.length < SANCTION_LISTINGS_MAX || changes.length === 0) break;
  }
  const suspended = (await listOwnerListingsByStatus(uid, ["paused"], SANCTION_LISTINGS_MAX)).filter((listing) => listing.pausedReason === "moderation");
  const moved = await changeListings(
    suspended,
    (listing) => (listing.status === "paused" && listing.pausedReason === "moderation" ? { patch: { pausedReason: "pro_revalidation", version: listing.version + 1, updatedAt: now }, search: null } : null),
    now,
    "revalidation hold",
  );
  return [...ids, ...moved.map((change) => change.listing.id)];
}

/** The new validation: listings paused for the revalidation come back, published if not expired, else expired (renewable). */
export async function resumeRevalidationPaused(uid: string, now: Date): Promise<string[]> {
  const life = await lifetime();
  const ids: string[] = [];
  const held = (listing: ListingRecord) => listing.status === "paused" && listing.pausedReason === "pro_revalidation";
  for (let round = 0; round < REVALIDATION_LISTING_ROUNDS; round += 1) {
    const listings = await listOwnerListingsByStatus(uid, ["paused"], SANCTION_LISTINGS_MAX);
    const changes = await changeListings(
      listings.filter(held),
      (listing) => {
        if (!held(listing)) return null;
        const live = listing.expiresAt !== undefined && listing.expiresAt.getTime() > now.getTime();
        const { patch } = listingTransition(listing, live ? "published" : "expired", { now, lifetime: life });
        return {
          patch: { ...patch, pausedReason: null, adsEligible: live && adsEligibleOf({ status: "published", moderation: listing.moderation, subcategoryId: listing.subcategoryId }) },
          search: live ? "upsert" : null,
        };
      },
      now,
      "revalidation resume",
    );
    ids.push(...changes.map((change) => change.listing.id));
    if (listings.length < SANCTION_LISTINGS_MAX || changes.length === 0) break;
  }
  return ids;
}

/** proValidationWithdrawn; a failure is logged, never thrown (the withdrawal is committed). */
async function notifyWithdrawal(profile: ProProfileDoc, proId: string, statement: string, now: Date): Promise<void> {
  try {
    const to = await listingRecipient(profile.ownerUid);
    if (!to) return;
    const contact = (await getLegalConfig()).dsaContactEmail;
    await sendMail({
      locale: to.locale,
      to: to.email,
      priority: "transactional",
      template: "proValidationWithdrawn",
      idempotencyKey: `proValidationWithdrawn-${proId}-${now.getTime()}`,
      data: { displayName: to.displayName, shopName: profile.name, reason: statement, contact },
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, proId }, "pro withdrawal mail failed");
  }
}
