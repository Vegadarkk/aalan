"use client";

import { CalendarCheck, Clock3, MessageSquare } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import type { ConversationView } from "@/lib/contracts/messaging";
import type { RentalRequestView } from "@/lib/contracts/rental-requests";
import { rentalRequestOpen } from "@/lib/rental-requests/rules";
import { moroccoToday } from "@/lib/listings/rental-availability";
import { cn } from "@/lib/utils";
import { formatRentalDay } from "./rental-day";

// The renter's own booking request on the listing page (audit L4-09): « Votre demande du … est
// envoyée » or « confirmée », and the conversation. The page is cached: this is drawn in the
// browser, for the signed-in renter only, from the first page of the inbox.

/** The request to show: the current one while open, else the next accepted rental still ahead. */
export function shownRentalRequest(conversation: Pick<ConversationView, "rentalRequest" | "rentalHistory">, now: number): RentalRequestView | null {
  const today = moroccoToday(now);
  const current = conversation.rentalRequest;
  if (current && rentalRequestOpen(current, today)) return current;
  return (conversation.rentalHistory ?? []).filter((request) => request.status === "accepted" && rentalRequestOpen(request, today)).sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
}

export function RentalRequestBanner({ cid, request, compact = false }: { cid: string; request: RentalRequestView; compact?: boolean }) {
  const t = useTranslations("RentalRequest.banner");
  const locale = useLocale() as Locale;
  const accepted = request.status === "accepted";
  const stay = request.unit === "night";
  const values = { from: formatRentalDay(request.from, locale), to: formatRentalDay(request.to, locale) };
  const Icon = accepted ? CalendarCheck : Clock3;
  return (
    <div
      role="status"
      data-testid="rental-request-banner"
      data-status={request.status}
      className={cn("flex items-start gap-2.5 rounded-md border text-sm", compact ? "px-3 py-2" : "p-3", accepted ? "border-success/40 bg-success-surface" : "border-border bg-surface-muted")}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", accepted ? "text-success" : "text-foreground-muted")} aria-hidden="true" />
      <div className={cn("flex min-w-0 flex-1 gap-x-3 gap-y-1", compact ? "flex-wrap items-baseline" : "flex-col")}>
        <p className="font-medium text-pretty">{t(`${stay ? "home." : ""}${accepted ? "accepted" : "requested"}`, values)}</p>
        <Link href={`/messages/${cid}`} className="inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          {t("open")}
        </Link>
      </div>
    </div>
  );
}
