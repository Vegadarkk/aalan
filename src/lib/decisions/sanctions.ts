import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { listingLifetime } from "@/config/pricing";
import { enqueueAiTask } from "@/lib/ai/queue";
import { alert } from "@/lib/alert";
import { audit } from "@/lib/audit";
import { getListingTx, listOwnerListingsByStatus, updateListingTx, type ListingFieldPatch, type ListingRecord, type OwnerListingFilter } from "@/lib/db/repositories/listings";
import { listDecisionsForUser } from "@/lib/db/repositories/moderation-decisions";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { getUserRecord, type UserRecord } from "@/lib/db/repositories/profiles";
import { enqueueSearchOutboxTx } from "@/lib/db/repositories/search-outbox";
import type { Transaction } from "firebase-admin/firestore";
import { auth, db } from "@/lib/firebase/admin";
import { getClaims, setClaims } from "@/lib/firebase/claims";
import { getLegalConfig } from "@/lib/legal/config";
import { purgeAtFor, transition, withLivePrices, type Lifetime } from "@/lib/listings/lifecycle";
import { revalidateListingPaths } from "@/lib/listings/revalidate";
import { logger } from "@/lib/logging/logger";
import { consume } from "@/lib/quota";
import { adsEligibleOf } from "@/lib/reports";
import { notifySearchIndex } from "@/lib/search/queue";
import { levelAfterReversal, type Sanction } from "./ladder";
import { privateFromSnapshot, privateRef, suspensionFromSnapshot, suspensionRef, userRef } from "./repository";

// Account sanctions (design D14): the Auth side (st claim for a suspension, disabled account and
// revoked tokens for a ban) is applied before the decision's transaction and undone if it fails;
// the listings follow after the commit (paused with pausedReason "moderation" for a suspension,
// removed for a ban, one transaction each, search outbox + fast lane, ISR revalidation).
// lift-suspensions and the appeal reversals undo them.

/** Listings one round of an account walk reads (an individual has 20 active ones; Pro plans more). */
export const SANCTION_LISTINGS_MAX = 200;
/** Rounds an account walk takes at most (4,000 listings); what is left then is alerted. */
export const SANCTION_LISTING_ROUNDS = 20;
const BAN_STATUSES = ["published", "paused", "pending_review"] as const;

export type Undo = () => Promise<void>;

/**
 * Auth side of a sanction; returns how to undo it (the decision's transaction failed). A
 * suspension adds `st: "suspended"` to the current claims (setClaims revokes the refresh tokens);
 * a ban disables the account and revokes its tokens (the claims stay, for a reversal).
 */
export async function applyAuthSanction(uid: string, sanction: Sanction): Promise<Undo> {
  if (sanction.action === "suspend_account") {
    const before = await getClaims(uid);
    if (before.st === "suspended") return async () => undefined;
    await setClaims(uid, { ...before, st: "suspended" });
    return async () => setClaims(uid, before);
  }
  if (sanction.action === "ban") {
    const record = await auth().getUser(uid);
    await auth().updateUser(uid, { disabled: true });
    await auth().revokeRefreshTokens(uid);
    const wasDisabled = record.disabled;
    return async () => {
      if (!wasDisabled) await auth().updateUser(uid, { disabled: false });
    };
  }
  return async () => undefined;
}

/**
 * Auth side of a reversed sanction (appeal, D16), before the reversal's transaction: a ban's
 * account enabled again, a suspension's `st` claim dropped. Returns how to undo it.
 */
export async function reverseAuthSanction(uid: string, action: Sanction["action"]): Promise<Undo> {
  if (action === "ban") {
    const record = await auth().getUser(uid);
    if (!record.disabled) return async () => undefined;
    await auth().updateUser(uid, { disabled: false });
    return async () => {
      await auth().updateUser(uid, { disabled: true });
      await auth().revokeRefreshTokens(uid);
    };
  }
  if (action === "suspend_account") {
    const before = await getClaims(uid);
    if (before.st !== "suspended") return async () => undefined;
    const { st: _st, ...rest } = before;
    await setClaims(uid, rest);
    return async () => setClaims(uid, before);
  }
  return async () => undefined;
}

/** Runs an undo, logging (never throwing) when it fails too. */
export async function undoQuietly(undo: Undo, context: Record<string, unknown>): Promise<void> {
  try {
    await undo();
  } catch (error) {
    logger.error({ ...context, err: (error as Error).message }, "decisions: sanction rollback failed");
  }
}

export async function lifetime(): Promise<Lifetime> {
  return listingLifetime(await getLegalConfig());
}

export interface ListingChange {
  patch: ListingFieldPatch & { version: number };
  search: "upsert" | "delete" | null;
}

export interface ChangedListing {
  listing: ListingRecord;
  search: boolean;
}

/** One listing transaction: read, compute the change (null: leave it), write the patch and its outbox entry. */
async function changeListing(id: string, compute: (listing: ListingRecord) => ListingChange | null, now: Date): Promise<ChangedListing | null> {
  return db().runTransaction(async (tx) => {
    const listing = await getListingTx(tx, id);
    if (!listing) return null;
    const change = compute(listing);
    if (!change) return null;
    updateListingTx(tx, id, change.patch);
    if (change.search) enqueueSearchOutboxTx(tx, id, change.search, change.patch.version, now);
    return { listing, search: change.search !== null };
  });
}

/**
 * Listings back online after a pause (suspension, Pro revalidation): content edited while paused had
 * the rule screen only (audit C-1), so the agent screens the committed version (the transition
 * bumps it by one) unless a moderator approved it. The agent skips content it already screened
 * (same input hash): an unchanged listing costs no model call. Never throws.
 */
export async function screenResumedListings(changes: readonly ChangedListing[]): Promise<void> {
  for (const { listing, search } of changes) {
    // `search` is set exactly when the listing went back to published (an expired one is not public).
    if (!search || listing.moderation.state === "human_ok") continue;
    try {
      await enqueueAiTask("listing_screen", { type: "listing", id: listing.id }, { version: listing.version + 1 });
    } catch (error) {
      logger.warn({ listingId: listing.id, err: (error as Error).message }, "decisions: screening request after a resume failed");
    }
  }
}

/** Search fast lane and ISR revalidation after listing changes (never throws). */
export async function afterListingChanges(changes: readonly ChangedListing[], publicId?: string): Promise<void> {
  try {
    await notifySearchIndex(changes.filter((change) => change.search).map((change) => change.listing.id));
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "decisions: search fast lane failed");
  }
  for (const change of changes) revalidateListingPaths({ slugId: change.listing.slugId });
  const profile = publicId ?? changes[0]?.listing.sellerPublicId;
  if (profile) revalidateListingPaths({ publicId: profile });
}

/** Applies `compute` to each listing, one transaction each; a failure is logged and the next one goes on. */
export async function changeListings(listings: readonly ListingRecord[], compute: (listing: ListingRecord) => ListingChange | null, now: Date, label: string): Promise<ChangedListing[]> {
  const changes: ChangedListing[] = [];
  for (const listing of listings) {
    try {
      const change = await changeListing(listing.id, compute, now);
      if (change) changes.push(change);
    } catch (error) {
      logger.error({ listingId: listing.id, err: (error as Error).message }, `decisions: ${label} failed for a listing`);
    }
  }
  await afterListingChanges(changes);
  return changes;
}

/**
 * Every listing of an account in `statuses` (and `only`), changed in rounds of
 * SANCTION_LISTINGS_MAX: each round reads what is left (a changed listing leaves the query) until a
 * short read, a round that changes nothing, or SANCTION_LISTING_ROUNDS. A listing still matching
 * after the walk (a failed change, more than the rounds hold) is alerted to staff: a sanction must
 * never leave part of an account online unnoticed.
 */
export async function walkOwnerListings(
  uid: string,
  statuses: readonly ListingRecord["status"][],
  only: OwnerListingFilter,
  compute: (listing: ListingRecord) => ListingChange | null,
  now: Date,
  label: string,
): Promise<ChangedListing[]> {
  const changed: ChangedListing[] = [];
  for (let round = 0; round < SANCTION_LISTING_ROUNDS; round += 1) {
    const listings = await listOwnerListingsByStatus(uid, statuses, SANCTION_LISTINGS_MAX, only);
    const changes = await changeListings(listings, compute, now, label);
    changed.push(...changes);
    if (listings.length < SANCTION_LISTINGS_MAX || changes.length === 0) break;
  }
  const left = await listOwnerListingsByStatus(uid, statuses, 1, only);
  if (left.length > 0) {
    logger.error({ uid, label, changed: changed.length }, "decisions: account walk left listings unchanged");
    await alert({
      severity: "P1",
      title: `Annonces non traitées après une mesure sur un compte (${label}, ${uid})`,
      body: `L'étape « ${label} » a traité ${changed.length} annonce(s) du compte ${uid}, mais il en reste au moins une dans l'état ${statuses.join("/")}. Relancer la mesure ou traiter les annonces restantes depuis l'administration.`,
    }).catch((error: unknown) => logger.error({ uid, err: (error as Error).message }, "decisions: incomplete walk alert failed"));
  }
  return changed;
}

/** `hiddenBy` dropped when the report that hid the listing is closed by the account decision (a user target's reports). */
function moderationAfter(listing: ListingRecord, clearHiddenFor: ReadonlySet<string> | undefined): ListingRecord["moderation"] {
  const hiddenBy = listing.moderation.hiddenBy;
  if (!hiddenBy || !clearHiddenFor?.has(hiddenBy.reportId)) return listing.moderation;
  const { hiddenBy: _hidden, ...moderation } = listing.moderation;
  return moderation;
}

/**
 * Suspension (D14): the published listings are paused with pausedReason "moderation".
 * `clearHiddenFor`: report ids the decision closed (a user target): listings they hid are not hidden at the lift.
 */
export async function pauseListingsForSuspension(uid: string, now: Date, clearHiddenFor?: ReadonlySet<string>): Promise<string[]> {
  const life = await lifetime();
  const changes = await walkOwnerListings(
    uid,
    ["published"],
    {},
    (listing) => {
      if (listing.status !== "published") return null;
      const { patch } = transition(listing, "paused", { now, lifetime: life, pausedReason: "moderation" });
      return { patch: { ...patch, moderation: moderationAfter(listing, clearHiddenFor), adsEligible: false }, search: "delete" };
    },
    now,
    "suspension pause",
  );
  return changes.map((change) => change.listing.id);
}

/** End of a suspension: listings paused by moderation come back, published if not expired, else expired (renewable). */
export async function resumeModerationPaused(uid: string, now: Date): Promise<string[]> {
  const life = await lifetime();
  const changes = await walkOwnerListings(
    uid,
    ["paused"],
    { pausedReason: "moderation" },
    (listing) => {
      if (listing.status !== "paused" || listing.pausedReason !== "moderation") return null;
      const live = listing.expiresAt !== undefined && listing.expiresAt.getTime() > now.getTime();
      const { patch } = transition(listing, live ? "published" : "expired", { now, lifetime: life });
      const moderation = listing.moderation;
      return {
        patch: { ...patch, pausedReason: null, adsEligible: live && adsEligibleOf({ status: "published", moderation, subcategoryId: listing.subcategoryId }) },
        search: live ? "upsert" : null,
      };
    },
    now,
    "suspension resume",
  );
  await screenResumedListings(changes);
  return changes.map((change) => change.listing.id);
}

/** Ban (D14): published, paused and held listings are removed (decision per account); marked with the ban decision for a reversal. */
export async function removeListingsForBan(uid: string, decisionId: string, actorUid: string, now: Date, clearHiddenFor?: ReadonlySet<string>): Promise<string[]> {
  const life = await lifetime();
  const changes = await walkOwnerListings(
    uid,
    BAN_STATUSES,
    {},
    (listing) => {
      if (!(BAN_STATUSES as readonly string[]).includes(listing.status)) return null;
      const { patch, effects } = transition(listing, "removed", { now, lifetime: life });
      return {
        patch: { ...patch, adsEligible: false, moderation: { ...moderationAfter(listing, clearHiddenFor), lastDecisionId: decisionId, reviewedBy: actorUid, reviewedAt: now } },
        search: effects.search,
      };
    },
    now,
    "ban removal",
  );
  return changes.map((change) => change.listing.id);
}

/**
 * What a listing restored by a reversal may come back as, given its owner and shop now (the queue
 * approval's own conditions, src/lib/listings/approval-guard.ts): nothing for a missing, closed or
 * banned owner (the listing stays removed), paused for a suspended owner (the lift resumes it) or a
 * shop under revalidation (the new validation resumes it), held for review for a restricted owner.
 */
export type RestoreHold = "none" | "offline" | "moderation" | "pro_revalidation" | "review";

export function restoreHold(owner: Pick<UserRecord, "status"> | null, shop: { lifecycle: string } | null): RestoreHold {
  if (!owner || owner.status === "closed" || owner.status === "banned") return "offline";
  if (shop?.lifecycle === "revalidation_required") return "pro_revalidation";
  if (owner.status === "suspended") return "moderation";
  return owner.status === "restricted" ? "review" : "none";
}

/** restoreHold of a listing's owner and shop, read now (inside `tx` when given, before its writes). */
export async function readRestoreHold(listing: { ownerUid: string; proId?: string | null | undefined }, tx?: Transaction): Promise<RestoreHold> {
  const owner = await getUserRecord(listing.ownerUid, tx);
  const shop = listing.proId ? await getProProfile(listing.proId, tx) : null;
  return restoreHold(owner, shop);
}

/**
 * A removed listing restored (appeal reversed, D16), or null when it must stay removed (`hold`
 * offline). Never published before, or an edit still held for review when it was removed: back to
 * review (and the moderation queue), never online unreviewed. Expiry passed: expired (the owner may
 * renew it). Otherwise published with its own dates, unless the hold pauses it or sends it to
 * review. The lifecycle table has no `removed ->` exit but the purge: this is the reversal's own.
 */
export function unremovePatch(listing: ListingRecord, now: Date, life: Lifetime, hold: RestoreHold = "none"): ListingChange | null {
  if (hold === "offline") return null;
  const base = { version: listing.version + 1, updatedAt: now, pausedReason: null };
  if (!listing.publishedAt) return { patch: { ...base, status: "pending_review", purgeAt: null }, search: null };
  const live = listing.expiresAt !== undefined && listing.expiresAt.getTime() > now.getTime();
  if (!live) return { patch: { ...base, status: "expired", purgeAt: purgeAtFor(now, life) }, search: null };
  const purgeAt = purgeAtFor(listing.expiresAt ?? now, life);
  if (listing.moderation.state === "needs_review" || hold === "review") return { patch: { ...base, status: "pending_review", purgeAt }, search: null };
  if (hold === "moderation" || hold === "pro_revalidation") return { patch: { ...base, status: "paused", pausedReason: hold, purgeAt }, search: null };
  return withLivePrices(listing, { patch: { ...base, status: "published" as const, purgeAt }, search: "upsert" as const }, now);
}

/** Ban reversed: the listings this ban removed come back. */
export async function restoreBannedListings(uid: string, banDecisionId: string, actorUid: string, now: Date): Promise<string[]> {
  const life = await lifetime();
  // Read after the reversal's commit: a closed account keeps them removed, a standing suspension
  // or a shop under revalidation brings them back paused.
  const owner = await getUserRecord(uid);
  const hold = restoreHold(owner, owner?.proId ? await getProProfile(owner.proId) : null);
  if (hold === "offline") return [];
  const changes = await walkOwnerListings(
    uid,
    ["removed"],
    { lastDecisionId: banDecisionId },
    (listing) => {
      if (listing.status !== "removed" || listing.moderation.lastDecisionId !== banDecisionId) return null;
      const change = unremovePatch(listing, now, life, hold);
      if (!change) return null;
      const moderation = { ...listing.moderation, reviewedBy: actorUid, reviewedAt: now };
      const status = change.patch.status ?? listing.status;
      return { patch: { ...change.patch, moderation, adsEligible: adsEligibleOf({ status, moderation, subcategoryId: listing.subcategoryId }) }, search: change.search };
    },
    now,
    "ban reversal",
  );
  return changes.map((change) => change.listing.id);
}

export interface StandingSuspension {
  decisionId: string;
  until: Date;
}

/**
 * The account's suspension that still stands once `excludeId` is reversed: a suspend_account
 * decision about it, not superseded, whose own end (createdAt + durationDays) is still ahead; the
 * latest-ending one. Null when none: the account may be lifted.
 */
export async function standingSuspension(uid: string, excludeId: string, now: Date): Promise<StandingSuspension | null> {
  let best: StandingSuspension | null = null;
  for (const decision of await listDecisionsForUser(uid, 50)) {
    if (decision.id === excludeId || decision.action !== "suspend_account" || decision.supersededBy || !decision.durationDays) continue;
    const until = new Date(decision.createdAt.getTime() + decision.durationDays * 86_400_000);
    if (until.getTime() > now.getTime() && (!best || until.getTime() > best.until.getTime())) best = { decisionId: decision.id, until };
  }
  return best;
}

/** The `st` claim made to match the account's status after a reversal (kept, added or dropped). */
export async function syncSuspendedClaim(uid: string, suspended: boolean): Promise<void> {
  const before = await getClaims(uid);
  if (suspended === (before.st === "suspended")) return;
  if (suspended) {
    await setClaims(uid, { ...before, st: "suspended" });
    return;
  }
  const { st: _st, ...rest } = before;
  await setClaims(uid, rest);
}

export interface LiftOptions {
  now?: Date;
  /** Lift only the suspension of this decision (an appeal reversal); undefined: whatever is due. */
  decisionId?: string;
  /** Who lifts it: the job ("system") or the reviewer of an appeal. */
  actor: { uid: string; role: "system" | "moderator" | "admin" };
  /** The appeal reversal also takes one strike off. */
  reduceStrikes?: boolean;
}

/**
 * Ends a suspension (lift-suspensions job): the claim first, then one transaction (suspension
 * document deleted, `suspended` -> `active`, `strikes.suspendedUntil` dropped), then the listings.
 * The claim comes back when the transaction fails or finds the suspension extended (the document
 * stays: the next run retries). False when there is nothing to lift (no document, another
 * decision's, not ended yet). An appeal reversal lifts inside its own decision (decide()).
 */
export async function liftSuspension(uid: string, options: LiftOptions): Promise<boolean> {
  const now = options.now ?? new Date();
  const current = suspensionFromSnapshot(await suspensionRef(uid).get());
  void consume("firestore.reads", 1);
  if (!current || (options.decisionId && current.decisionId !== options.decisionId)) return false;
  // The job lifts ended suspensions only (one extended meanwhile runs on).
  const due = (suspension: { until: Date }) => options.decisionId !== undefined || suspension.until.getTime() <= now.getTime();
  if (!due(current)) return false;
  const status = (await userRef(uid).get()).get("status");
  void consume("firestore.reads", 1);
  const undo = status === "banned" ? null : await reverseAuthSanction(uid, "suspend_account");
  let lifted: boolean;
  try {
    lifted = await db().runTransaction(async (tx) => {
      const [suspensionSnap, userSnap, privateSnap] = await Promise.all([tx.get(suspensionRef(uid)), tx.get(userRef(uid)), tx.get(privateRef(uid))]);
      void consume("firestore.reads", 3);
      const suspension = suspensionFromSnapshot(suspensionSnap);
      if (!suspension || suspension.decisionId !== current.decisionId || !due(suspension)) return false;
      tx.delete(suspensionRef(uid));
      let writes = 1;
      if (userSnap.exists && userSnap.get("status") === "suspended") {
        tx.update(userRef(uid), { status: "active", updatedAt: Timestamp.fromDate(now) });
        writes += 1;
      }
      const account = privateFromSnapshot(privateSnap);
      if (account) {
        const level = options.reduceStrikes ? levelAfterReversal(account.strikes.level) : account.strikes.level;
        tx.update(privateRef(uid), { "strikes.level": level, "strikes.suspendedUntil": FieldValue.delete() });
        writes += 1;
      }
      void consume("firestore.writes", writes);
      return true;
    });
  } catch (error) {
    if (undo) await undoQuietly(undo, { job: "lift" });
    throw error;
  }
  if (!lifted) {
    // Extended or lifted meanwhile: the claim follows the document again.
    if (undo) await undoQuietly(undo, { job: "lift" });
    return false;
  }
  const resumed = status === "banned" ? [] : await resumeModerationPaused(uid, now);
  await audit({
    actorUid: options.actor.uid,
    actorRole: options.actor.role,
    action: "user.unsuspend",
    target: { type: "user", id: uid },
    automated: options.actor.role === "system",
    reason: `${options.decisionId ? "appeal reversed" : "suspension ended"}; decision ${current.decisionId}; ${resumed.length} listing(s) resumed`,
    at: now,
  });
  return true;
}
