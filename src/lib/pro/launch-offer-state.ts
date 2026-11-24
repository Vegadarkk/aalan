import "server-only";
import { launchOfferProSeatsLeft, launchOfferSeatsLeft, launchPlacesOpen, type LaunchOffer } from "@/config/pricing";
import { launchOfferSeatsGranted, launchPlacesGranted } from "@/lib/db/repositories/pro-profiles";
import { logger } from "@/lib/logging/logger";

// What a shop validated now (or an individual) would get from the launch places (owner, 2026-11-05,
// 2026-11-11 and 2026-11-24): `proSeats` places for shops, `seats` for individuals, two counters,
// until `grantsUntil`; a shop gets Essentiel free for `months`, an individual
// `individual.credits` gift credits. Read by GET /api/pro/me and the public pricing pages.

export interface LaunchOfferState {
  months: number;
  noticeDays: number;
  /** Individuals' places, and those left (0: all taken; null: the counter could not be read). */
  seats: number;
  seatsLeft: number | null;
  /** Shops' places, and those left (same meaning). */
  proSeats: number;
  proSeatsLeft: number | null;
  /** Last day a place is given (ISO, exclusive end), or null. */
  grantsUntil: string | null;
  /** Gift credits of an individual's place and their validity in days (0 credits: shops only). */
  individualCredits: number;
  individualDays: number;
  /** An individual's place waits for a verified phone number. */
  individualRequiresPhone: boolean;
}

/** A counter's places left, or null when it could not be read (the grant re-checks it). */
async function left(read: () => Promise<number>, places: (granted: number) => number): Promise<number | null> {
  try {
    return places(await read());
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "launch places counter not read");
    return null;
  }
}

/** The open offer and the places left on each side; null when it is closed or every place is taken. */
export async function launchOfferState(offer: LaunchOffer, now = new Date()): Promise<LaunchOfferState | null> {
  if (!launchPlacesOpen(offer, now)) return null;
  const [seatsLeft, proSeatsLeft] = await Promise.all([
    left(() => launchPlacesGranted(), (granted) => launchOfferSeatsLeft(offer, granted)),
    left(() => launchOfferSeatsGranted(), (granted) => launchOfferProSeatsLeft(offer, granted)),
  ]);
  if (seatsLeft === 0 && proSeatsLeft === 0) return null;
  return {
    months: offer.months,
    noticeDays: offer.noticeDays,
    seats: offer.seats,
    seatsLeft,
    proSeats: offer.proSeats,
    proSeatsLeft,
    grantsUntil: offer.grantsUntil,
    individualCredits: offer.individual.credits,
    individualDays: offer.individual.days,
    individualRequiresPhone: offer.individual.requirePhone,
  };
}
