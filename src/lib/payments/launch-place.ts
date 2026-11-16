import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { launchOfferSeatsLeft, launchPlacesOpen, type LaunchOffer } from "@/config/pricing";
import { audit } from "@/lib/audit";
import { getPricing } from "@/lib/config/runtime";
import { launchOfferSeatsGranted, launchOfferSeatsRef } from "@/lib/db/repositories/pro-profiles";
import { getLedgerEntry, getLedgerEntryTx, getWalletTx, recordWalletOperationTx, walletStateAt } from "@/lib/db/repositories/wallets";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { logger } from "@/lib/logging/logger";
import { sendMail } from "@/lib/mail";
import { listingRecipient } from "@/lib/mail/recipients";
import { consume } from "@/lib/quota";
import { pepperedHash } from "@/lib/security/hash";
import { grantLaunchGift } from "./wallet";

// An individual's launch place (owner, 2026-11-11): the launch places are shared with the shops
// (`system/launchOfferSeats`, taken at a shop's first validation in src/lib/pro/review.ts). An
// individual takes one once a listing of theirs passed moderation (it got a `publishedAt`) and,
// when `individual.requirePhone`, their phone number is verified: `individual.credits` gift credits
// in the wallet's plan pool, valid `individual.days`, the only credits spendable while sales are
// closed. One place per account (ledger entry `launch_place`, created once) and per phone number,
// for good (`launchPlaces/{peppered hash of the number}`: a number moved to another account takes
// no second place). Called after each publication or approval of an individual's listing and after
// each phone verification; every condition is read again in the transaction, so a retry or a race
// gives at most one place.

export const LAUNCH_PLACE_ENTRY_ID = "launch_place";

export type LaunchPlaceOutcome =
  | "granted"
  | "closed"
  | "full"
  | "already"
  | "not_individual"
  | "no_listing"
  | "phone_unverified"
  | "phone_used";

/** What the user's documents say, read in the transaction (pure decision, tested apart). */
export interface LaunchPlaceFacts {
  offer: LaunchOffer;
  now: Date;
  granted: number;
  /** `users/{uid}`: missing, or its type, status and shop link. */
  user: { type?: unknown; status?: unknown; proId?: unknown } | null;
  hasPublished: boolean;
  /** Verified number, or null. */
  phoneE164: string | null;
  /** The account already took a place. */
  alreadyGranted: boolean;
  /** The number already took a place (on any account). */
  phoneUsed: boolean;
}

/** The outcome for `facts`, "granted" when every condition holds. */
export function launchPlaceDecision(facts: LaunchPlaceFacts): LaunchPlaceOutcome {
  const { offer } = facts;
  if (offer.individual.credits <= 0 || !launchPlacesOpen(offer, facts.now)) return "closed";
  if (facts.alreadyGranted) return "already";
  if (!facts.user || facts.user.type !== "individual" || facts.user.status !== "active" || typeof facts.user.proId === "string") return "not_individual";
  if (!facts.hasPublished) return "no_listing";
  if (offer.individual.requirePhone && !facts.phoneE164) return "phone_unverified";
  if (facts.phoneUsed) return "phone_used";
  if (launchOfferSeatsLeft(offer, facts.granted) <= 0) return "full";
  return "granted";
}

/** End of the gift credits given at `now`. */
export function launchGiftEnd(offer: LaunchOffer, now: Date): Date {
  return new Date(now.getTime() + offer.individual.days * 24 * 60 * 60 * 1000);
}

/**
 * When a number's marker goes: `individual.days` after the last day places are given (the gift
 * credits of the last place are spent or lost by then), or after the year from `now` without one.
 */
export function launchPlaceMarkerPurgeAt(offer: LaunchOffer, now: Date): Date {
  const lastGrant = offer.grantsUntil ? Date.parse(offer.grantsUntil) : now.getTime() + 365 * 24 * 60 * 60 * 1000;
  return new Date(lastGrant + offer.individual.days * 24 * 60 * 60 * 1000);
}

const phoneMarkerRef = (e164: string) => db().collection(COLLECTIONS.launchPlaces).doc(pepperedHash("launch-place", e164));

/** Ever published by `uid` (a listing with a publication date: it passed moderation). */
async function hasPublishedListing(uid: string): Promise<boolean> {
  const snapshot = await db().collection(COLLECTIONS.listings).where("ownerUid", "==", uid).where("publishedAt", ">=", Timestamp.fromMillis(0)).limit(1).get();
  void consume("firestore.reads", 1);
  return !snapshot.empty;
}

/**
 * Gives `uid` a launch place when every condition holds (see the header). Never throws: a failure is
 * logged and the next publication or verification tries again.
 */
export async function claimLaunchPlace(uid: string, now = new Date()): Promise<LaunchPlaceOutcome | "failed"> {
  try {
    const pricing = await getPricing();
    const offer = pricing.launchOffer;
    if (offer.individual.credits <= 0 || !launchPlacesOpen(offer, now)) return "closed";
    // Cheap checks first (every publication of an individual calls this): one read once granted.
    if (await getLedgerEntry(uid, LAUNCH_PLACE_ENTRY_ID)) return "already";
    // Outside the transaction (a query); a listing published once keeps its date.
    const hasPublished = await hasPublishedListing(uid);
    if (!hasPublished) return "no_listing";
    const firestore = db();
    const userRef = firestore.collection(COLLECTIONS.users).doc(uid);
    const privateRef = userRef.collection(COLLECTIONS.userPrivate).doc(COLLECTIONS.userPrivateDoc);
    const result = await firestore.runTransaction(async (tx) => {
      const [user, account, entry, granted] = await Promise.all([tx.get(userRef), tx.get(privateRef), getLedgerEntryTx(tx, uid, LAUNCH_PLACE_ENTRY_ID), launchOfferSeatsGranted(tx)]);
      const e164 = account.get("phoneVerifiedAt") ? account.get("phoneE164") : undefined;
      const phoneE164 = typeof e164 === "string" && e164.length > 0 ? e164 : null;
      const marker = phoneE164 ? await tx.get(phoneMarkerRef(phoneE164)) : null;
      void consume("firestore.reads", marker ? 3 : 2);
      const outcome = launchPlaceDecision({
        offer,
        now,
        granted,
        user: user.exists ? { type: user.get("type"), status: user.get("status"), proId: user.get("proId") } : null,
        hasPublished,
        phoneE164,
        alreadyGranted: entry !== null,
        phoneUsed: marker?.exists === true,
      });
      if (outcome !== "granted") return { outcome };
      const wallet = await getWalletTx(tx, uid);
      const gift = grantLaunchGift(walletStateAt(wallet, now), offer.individual.credits);
      const expiresAt = launchGiftEnd(offer, now);
      recordWalletOperationTx(tx, uid, LAUNCH_PLACE_ENTRY_ID, {
        before: wallet,
        state: gift.wallet,
        ledger: gift.ledger,
        entry: { refs: {}, actorUid: "system", at: now },
        now,
        resetsAt: expiresAt,
      });
      tx.set(launchOfferSeatsRef(), { granted: granted + 1, updatedAt: Timestamp.fromDate(now) });
      // The marker holds no account id; deleted by retention-purge at `purgeAt`.
      if (phoneE164) tx.create(phoneMarkerRef(phoneE164), { at: Timestamp.fromDate(now), purgeAt: Timestamp.fromDate(launchPlaceMarkerPurgeAt(offer, now)) });
      return { outcome, expiresAt, place: granted + 1 };
    });
    if (result.outcome !== "granted") return result.outcome;
    void consume("firestore.writes", 2);
    logger.info({ place: result.place }, "launch place granted to an individual");
    await audit({ actorUid: "system", actorRole: "system", action: "wallet.launch_place", target: { type: "user", id: uid }, automated: true, at: now }).catch((error: unknown) =>
      logger.error({ err: (error as Error).message }, "launch place audit failed"),
    );
    await notify(uid, offer.individual.credits, result.expiresAt);
    return "granted";
  } catch (error) {
    logger.error({ err: (error as Error).message }, "launch place not handled");
    return "failed";
  }
}

async function notify(uid: string, credits: number, expiresAt: Date): Promise<void> {
  try {
    const to = await listingRecipient(uid);
    if (!to) return;
    await sendMail({
      template: "launchPlaceGranted",
      locale: to.locale,
      to: to.email,
      priority: "transactional",
      idempotencyKey: `launchPlace-${uid}`,
      data: { displayName: to.displayName, credits, expiresAt: expiresAt.toISOString() },
    });
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "launch place mail not sent");
  }
}
