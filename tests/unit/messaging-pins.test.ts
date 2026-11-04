import { describe, expect, it } from "vitest";
import { formatSlotShortDay } from "@/components/appointments/format";
import { settledPins } from "@/components/messages/thread-state";
import type { AppointmentView } from "@/lib/contracts/appointments";
import type { OfferView } from "@/lib/contracts/offers";
import type { RentalRequestView } from "@/lib/contracts/rental-requests";

// The settled pinned cards fold into one line (audit zone 5 n°6), on large screens too beside a card that waits (audit L4-23).

const NOW = Date.UTC(2026, 10, 3, 18, 0);
const HOUR = 60 * 60 * 1000;
const slot = { start: Date.UTC(2026, 10, 4, 10, 0), minutes: 15 } as AppointmentView["chosen"] & object;

const offer = (patch: Partial<OfferView> = {}): OfferView => ({
  id: "o1",
  status: "accepted",
  madeByMe: true,
  amount: 2_800,
  counter: 2_900,
  price: 3_100,
  expiresAt: NOW + 24 * HOUR,
  updatedAt: NOW - HOUR,
  ...patch,
});

const appointment = (patch: Partial<AppointmentView> = {}): AppointmentView => ({
  id: "a1",
  kind: "meeting",
  status: "confirmed",
  proposedByMe: false,
  slots: [slot],
  chosen: slot,
  place: "Café de la Corniche",
  cancelledByMe: null,
  reason: null,
  updatedAt: NOW - HOUR,
  ...patch,
});

describe("settledPins", () => {
  it("summarizes an accepted offer and a confirmed appointment, folded under lg only when alone", () => {
    expect(settledPins({ offer: offer(), appointment: appointment() }, NOW)).toEqual({ offer: 2_900, appointment: { kind: "meeting", slot }, alongside: false });
    expect(settledPins({ offer: offer(), appointment: null }, NOW)).toEqual({ offer: 2_900, appointment: null, alongside: false });
    expect(settledPins({ offer: null, appointment: appointment({ kind: "visit" }) }, NOW)).toEqual({ offer: null, appointment: { kind: "visit", slot }, alongside: false });
  });

  it("keeps the card that waits for an answer full, and folds the settled one beside it on every screen", () => {
    for (const status of ["open", "countered"] as const) {
      expect(settledPins({ offer: offer({ status }), appointment: appointment() }, NOW), status).toEqual({ offer: null, appointment: { kind: "meeting", slot }, alongside: true });
      expect(settledPins({ offer: offer({ status }), appointment: null }, NOW), status).toBeNull();
    }
    expect(settledPins({ offer: offer(), appointment: appointment({ status: "proposed", chosen: null }) }, NOW)).toEqual({ offer: 2_900, appointment: null, alongside: true });
  });

  it("leaves out what is no longer pinned, and has nothing to fold without a settled card", () => {
    // A declined offer and an ended appointment are steps of the thread only.
    expect(settledPins({ offer: offer({ status: "declined" }), appointment: appointment() }, NOW)).toEqual({ offer: null, appointment: { kind: "meeting", slot }, alongside: false });
    expect(settledPins({ offer: offer(), appointment: appointment() }, slot.start + HOUR)).toEqual({ offer: 2_900, appointment: null, alongside: false });
    expect(settledPins({ offer: offer({ updatedAt: NOW - 8 * 24 * HOUR }), appointment: null }, NOW)).toBeNull();
    expect(settledPins({}, NOW)).toBeNull();
  });

  it("never folds a rental request or its history, and folds the settled cards beside them (audit L4-23)", () => {
    const request: RentalRequestView = { id: "r1", status: "requested", requestedByMe: true, from: "2026-11-10", to: "2026-11-12", unit: "day", pickup: null, blocked: false, updatedAt: NOW };
    const pickup = appointment({ kind: "pickup" });
    expect(settledPins({ appointment: pickup, rentalRequest: request }, NOW)).toEqual({ offer: null, appointment: { kind: "pickup", slot }, alongside: true });
    expect(settledPins({ offer: offer(), rentalHistory: [{ ...request, status: "declined" }] }, NOW)).toEqual({ offer: 2_900, appointment: null, alongside: true });
    expect(settledPins({ rentalRequest: request }, NOW)).toBeNull();
  });
});

describe("formatSlotShortDay", () => {
  it("writes the day short, in Morocco's time zone", () => {
    expect(formatSlotShortDay(slot.start, "fr")).toBe("mer. 4 nov.");
  });
});
