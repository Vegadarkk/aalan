import "server-only";
import { launchOfferOpen, launchOfferSeatsLeft, type LaunchOffer } from "@/config/pricing";
import { launchOfferSeatsGranted } from "@/lib/db/repositories/pro-profiles";
import { logger } from "@/lib/logging/logger";

// What a shop validated now would get from the launch offer (owner, 2026-11-05): the first `seats`
// validations get Essentiel free for `months`. Read by GET /api/pro/me and the public Pro pages.

export interface LaunchOfferState {
  months: number;
  noticeDays: number;
  seats: number;
  /** Seats left, null when the counter could not be read. */
  seatsLeft: number | null;
}

/** The open offer and its seats left; null when it is closed or every seat is taken. */
export async function launchOfferState(offer: LaunchOffer, now = new Date()): Promise<LaunchOfferState | null> {
  if (!launchOfferOpen(offer, now)) return null;
  let seatsLeft: number | null = null;
  try {
    seatsLeft = launchOfferSeatsLeft(offer, await launchOfferSeatsGranted());
  } catch (error) {
    // The page still tells the offer; the validation re-checks the seats in its transaction.
    logger.warn({ err: (error as Error).message }, "launch offer seats not read");
  }
  if (seatsLeft === 0) return null;
  return { months: offer.months, noticeDays: offer.noticeDays, seats: offer.seats, seatsLeft };
}
