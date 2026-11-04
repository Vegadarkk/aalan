import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import rif from "../../messages/rif.json";
import { ACCEPTED_OFFER_SHOWN_MS, ConversationStatusBanner, listingConversationStatus, type ListingConversationStatus } from "@/components/listing/conversation-status";
import { APPOINTMENT_KINDS } from "@/lib/contracts/appointments";
import type { AppointmentView } from "@/lib/contracts/appointments";
import type { OfferView } from "@/lib/contracts/offers";

// The buyer's conversation recalled on the listing page (audit zone 5 n°14): which offer and which
// appointment show, and how they read.

const NOW = Date.UTC(2026, 10, 4, 9, 0);
const HOUR = 60 * 60_000;

const offer = (patch: Partial<OfferView>): OfferView => ({ id: "o1", status: "open", madeByMe: true, amount: 1300, counter: null, price: 1500, expiresAt: NOW + 40 * HOUR, updatedAt: NOW - HOUR, ...patch });
const appointment = (patch: Partial<AppointmentView>): AppointmentView => ({
  id: "a1",
  kind: "visit",
  status: "confirmed",
  proposedByMe: true,
  slots: [{ start: NOW + 49 * HOUR, minutes: 60 }],
  chosen: { start: NOW + 49 * HOUR, minutes: 60 },
  place: null,
  cancelledByMe: null,
  reason: null,
  updatedAt: NOW - HOUR,
  ...patch,
});

function render(status: ListingConversationStatus, locale: "fr" | "ar" = "fr", compact = false) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : fr} timeZone="Africa/Casablanca">
      <ConversationStatusBanner status={status} compact={compact} />
    </NextIntlClientProvider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("listingConversationStatus", () => {
  it("recalls nothing without an offer or an appointment", () => {
    expect(listingConversationStatus({ offer: null, appointment: null }, NOW)).toBeNull();
    expect(listingConversationStatus({}, NOW)).toBeNull();
  });

  it("recalls the accepted offer at its final amount, for a week", () => {
    expect(listingConversationStatus({ offer: offer({ status: "accepted", counter: 1400 }) }, NOW)?.offer).toEqual({ kind: "accepted", amount: 1400 });
    expect(listingConversationStatus({ offer: offer({ status: "accepted" }) }, NOW)?.offer).toEqual({ kind: "accepted", amount: 1300 });
    expect(listingConversationStatus({ offer: offer({ status: "accepted", updatedAt: NOW - ACCEPTED_OFFER_SHOWN_MS }) }, NOW)).toBeNull();
  });

  it("recalls an offer or a counter-offer that waits for an answer, until it expires", () => {
    expect(listingConversationStatus({ offer: offer({}) }, NOW)?.offer).toEqual({ kind: "open", amount: 1300 });
    expect(listingConversationStatus({ offer: offer({ status: "countered", counter: 1450 }) }, NOW)?.offer).toEqual({ kind: "countered", amount: 1450 });
    expect(listingConversationStatus({ offer: offer({ expiresAt: NOW }) }, NOW)).toBeNull();
    for (const status of ["declined", "withdrawn", "expired"] as const) expect(listingConversationStatus({ offer: offer({ status }) }, NOW), status).toBeNull();
  });

  it("recalls a confirmed appointment until its slot ends, not a proposal or a cancelled one", () => {
    const shown = listingConversationStatus({ appointment: appointment({}) }, NOW);
    expect(shown).toEqual({ offer: null, appointment: { kind: "visit", slot: { start: NOW + 49 * HOUR, minutes: 60 } } });
    expect(listingConversationStatus({ appointment: appointment({ chosen: { start: NOW - 2 * HOUR, minutes: 60 } }) }, NOW)).toBeNull();
    expect(listingConversationStatus({ appointment: appointment({ chosen: { start: NOW - 30 * 60_000, minutes: 60 } }) }, NOW)?.appointment).not.toBeNull();
    expect(listingConversationStatus({ appointment: appointment({ status: "proposed", chosen: null }) }, NOW)).toBeNull();
    expect(listingConversationStatus({ appointment: appointment({ status: "cancelled" }) }, NOW)).toBeNull();
  });

  it("keeps both together", () => {
    const both = listingConversationStatus({ offer: offer({ status: "accepted" }), appointment: appointment({ kind: "meeting" }) }, NOW);
    expect(both?.offer?.kind).toBe("accepted");
    expect(both?.appointment?.kind).toBe("meeting");
  });
});

describe("ConversationStatusBanner", () => {
  it("says the accepted offer and the appointment, in Morocco's time", () => {
    const html = render({ offer: { kind: "accepted", amount: 2900 }, appointment: { kind: "visit", slot: { start: Date.UTC(2026, 10, 4, 9, 0), minutes: 60 } } });
    expect(html).toContain('role="status"');
    expect(html).toContain('data-offer="accepted"');
    expect(html).toContain("bg-success-surface");
    // Morocco is on UTC since 20 September 2026 (lib/i18n/morocco-time.ts), whatever the runtime says.
    expect(text(html)).toMatch(/Offre acceptée à 2\s900\sDH/);
    expect(text(html)).toMatch(/Visite confirmée : mer\. 4 nov\. à 09:00/);
  });

  it("stays neutral while the seller has to answer", () => {
    const html = render({ offer: { kind: "open", amount: 1300 }, appointment: null });
    expect(html).not.toContain("bg-success-surface");
    expect(text(html)).toMatch(/Votre offre de 1\s300\sDH attend la réponse du vendeur/);
    expect(text(render({ offer: { kind: "countered", amount: 1450 }, appointment: null }))).toMatch(/Le vendeur vous propose 1\s450\sDH/);
  });

  it("reads in Arabic", () => {
    const html = render({ offer: { kind: "accepted", amount: 2900 }, appointment: null }, "ar", true);
    expect(text(html)).toContain("عرض مقبول بمبلغ");
  });

  it("has every wording in the three languages", () => {
    for (const messages of [fr, ar, rif]) {
      const status = messages.ListingPage.contact.status;
      for (const key of ["offerAccepted", "offerOpen", "offerCountered"] as const) expect(status[key]).toContain("{amount}");
      for (const kind of APPOINTMENT_KINDS) expect(status.appointment[kind]).toMatch(/\{day\}.*\{time\}/);
      expect(messages.ListingPage.contact.conversation).toBeTruthy();
      expect(messages.ListingPage.contact.conversationHint).toBeTruthy();
    }
  });
});
