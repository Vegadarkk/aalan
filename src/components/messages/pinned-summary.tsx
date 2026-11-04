"use client";

import { BadgeCheck, CalendarCheck, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatSlotClock, formatSlotShortDay } from "@/components/appointments/format";
import type { Locale } from "@/config/site";
import { formatPrice } from "@/lib/listings/client/format";
import { cn } from "@/lib/utils";
import type { SettledPins } from "./thread-state";

// Under lg, the settled pinned cards (accepted offer, confirmed appointment) fold into this one line
// so that the messages keep the screen (audit zone 5 n°6); on large screens too when another card
// stays open beside them (audit L4-23). It unfolds them on demand. A card that waits for an answer
// is never folded (settledPins).

export function PinnedSummary({ pins, open, controls, onToggle }: { pins: SettledPins; open: boolean; controls: string; onToggle: () => void }) {
  const t = useTranslations("Messaging.thread");
  const offer = useTranslations("Offers.card");
  const confirmedTitle = useTranslations("Appointments.confirmedTitle");
  const locale = useLocale() as Locale;
  const { appointment } = pins;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      data-testid="thread-pins-summary"
      className={cn(
        "mx-3 mt-3 flex min-h-11 shrink-0 items-center gap-x-4 rounded-lg border border-structure/25 bg-surface px-3.5 py-2 text-start text-sm shadow-sm lg:mx-5",
        !pins.alongside && "lg:hidden",
        "transition-colors duration-150 ease-door hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        {pins.offer !== null ? (
          <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
            <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
            {offer("acceptedTitle", { amount: formatPrice(pins.offer, locale) })}
          </span>
        ) : null}
        {appointment ? (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <CalendarCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
            {/* Said in words where the line has room (« Retrait confirmé », audit L4-23). */}
            <span className="font-medium max-sm:sr-only">{confirmedTitle(appointment.kind)}</span>
            <span className="inline-block first-letter:uppercase">{formatSlotShortDay(appointment.slot.start, locale)}</span>
            <span className="font-medium">{formatSlotClock(appointment.slot.start, locale)}</span>
          </span>
        ) : null}
      </span>
      <span className="sr-only">{t(open ? "pinsHide" : "pinsShow")}</span>
      <ChevronDown className={cn("size-4 shrink-0 text-foreground-muted transition-transform duration-200 ease-door motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
    </button>
  );
}
