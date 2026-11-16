import "server-only";
import { launchOfferSeatsLeft, launchPlacesOpen, type LaunchOffer } from "@/config/pricing";
import { launchOfferSeatsGranted } from "@/lib/db/repositories/pro-profiles";
import { logger } from "@/lib/logging/logger";

// What a shop validated now (or an individual) would get from the launch places (owner, 2026-11-05 and
// 2026-11-11): `seats` places shared by shops and individuals until `grantsUntil`; a shop gets
// Essentiel free for `months`, an individual `individual.credits` gift credits. Read by GET
// /api/pro/me and the public pricing pages.

export interface LaunchOfferState {
  months: number;
  noticeDays: number;
  seats: number;
  /** Seats left, null when the counter could not be read. */
  seatsLeft: number | null;
  /** Last day a place is given (ISO, exclusive end), or null. */
  grantsUntil: string | null;
  /** Gift credits of an individual's place and their validity in days (0 credits: shops only). */
  individualCredits: number;
  individualDays: number;
  /** An individual's place waits for a verified phone number. */
  individualRequiresPhone: boolean;
}

/** The open offer and its seats left; null when it is closed or every seat is taken. */
export async function launchOfferState(offer: LaunchOffer, now = new Date()): Promise<LaunchOfferState | null> {
  if (!launchPlacesOpen(offer, now)) return null;
  let seatsLeft: number | null = null;
  try {
    seatsLeft = launchOfferSeatsLeft(offer, await launchOfferSeatsGranted());
  } catch (error) {
    // The page still tells the offer; the validation re-checks the seats in its transaction.
    logger.warn({ err: (error as Error).message }, "launch offer seats not read");
  }
  if (seatsLeft === 0) return null;
  return {
    months: offer.months,
    noticeDays: offer.noticeDays,
    seats: offer.seats,
    seatsLeft,
    grantsUntil: offer.grantsUntil,
    individualCredits: offer.individual.credits,
    individualDays: offer.individual.days,
    individualRequiresPhone: offer.individual.requirePhone,
  };
}
