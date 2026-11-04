"use client";

import { BadgeCheck, CalendarCheck, HandCoins } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/config/site";
import type { AppointmentKind, Slot } from "@/lib/contracts/appointments";
import type { ConversationView } from "@/lib/contracts/messaging";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";
import { formatPrice, intlLocale } from "@/lib/listings/client/format";
import { offerFinalAmount } from "@/lib/offers/rules";
import { cn } from "@/lib/utils";

// Where the buyer stands with the seller, on the listing page (audit zone 5 n°14): the offer that
// waits for an answer or was accepted, the confirmed appointment. The page is cached for everyone:
// this is drawn in the browser, for the signed-in buyer only, from the first page of their inbox
// (the conversation row carries both). Type-only imports from the contracts: no zod in this chunk.

/** An accepted offer is recalled this long, as long as the thread pins it (offer-card.tsx). */
export const ACCEPTED_OFFER_SHOWN_MS = 7 * 24 * 60 * 60_000;

export interface ListingConversationStatus {
  offer: { kind: "accepted" | "open" | "countered"; amount: number } | null;
  appointment: { kind: AppointmentKind; slot: Slot } | null;
}

/** What the listing recalls of the buyer's conversation at `now`; null when nothing is worth it. */
export function listingConversationStatus(conversation: Pick<ConversationView, "offer" | "appointment">, now: number): ListingConversationStatus | null {
  const { offer, appointment } = conversation;
  let shownOffer: ListingConversationStatus["offer"] = null;
  if (offer) {
    if (offer.status === "accepted" && now - offer.updatedAt < ACCEPTED_OFFER_SHOWN_MS) shownOffer = { kind: "accepted", amount: offerFinalAmount(offer) };
    else if (offer.status === "open" && offer.expiresAt > now) shownOffer = { kind: "open", amount: offer.amount };
    else if (offer.status === "countered" && offer.counter !== null && offer.expiresAt > now) shownOffer = { kind: "countered", amount: offer.counter };
  }
  const chosen = appointment?.status === "confirmed" ? appointment.chosen : null;
  const shownAppointment = appointment && chosen && chosen.start + chosen.minutes * 60_000 > now ? { kind: appointment.kind, slot: chosen } : null;
  return shownOffer || shownAppointment ? { offer: shownOffer, appointment: shownAppointment } : null;
}

/** "mer. 4 nov." and "10:00", in Morocco's time zone (the appointment happens there). */
function slotParts(at: number, locale: Locale): { day: string; time: string } {
  const timeZone = moroccoTimeZone(at);
  const tag = intlLocale(locale);
  return {
    day: new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(at)),
    time: new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(at)),
  };
}

export function ConversationStatusBanner({ status, compact = false }: { status: ListingConversationStatus; compact?: boolean }) {
  const t = useTranslations("ListingPage.contact.status");
  const locale = useLocale() as Locale;
  const { offer, appointment } = status;
  const settled = offer?.kind !== "open" && offer?.kind !== "countered";
  const line = cn("flex items-start gap-2 text-pretty", compact && "items-center");
  return (
    <div
      role="status"
      data-testid="conversation-status"
      data-offer={offer?.kind}
      className={cn("flex rounded-md border text-sm", compact ? "flex-wrap gap-x-4 gap-y-1 px-3 py-2" : "flex-col gap-2 p-3", settled ? "border-success/40 bg-success-surface" : "border-border bg-surface-muted")}
    >
      {offer ? (
        <p className={cn(line, "font-medium tabular-nums")}>
          {offer.kind === "accepted" ? <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <HandCoins className="mt-0.5 size-4 shrink-0 text-foreground-muted" aria-hidden="true" />}
          <span>{t(offer.kind === "accepted" ? "offerAccepted" : offer.kind === "open" ? "offerOpen" : "offerCountered", { amount: formatPrice(offer.amount, locale) })}</span>
        </p>
      ) : null}
      {appointment ? (
        <p className={cn(line, "tabular-nums")}>
          <CalendarCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>{t(`appointment.${appointment.kind}`, slotParts(appointment.slot.start, locale))}</span>
        </p>
      ) : null}
    </div>
  );
}
