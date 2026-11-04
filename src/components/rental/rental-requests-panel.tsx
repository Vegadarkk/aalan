"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CalendarCheck, Inbox } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import type { ConversationView } from "@/lib/contracts/messaging";
import type { RentalRequestView } from "@/lib/contracts/rental-requests";
import { dayNumber, moroccoToday } from "@/lib/listings/rental-availability";
import { fetchInbox } from "@/lib/messaging/client";
import { rentalRequestOpen } from "@/lib/rental-requests/rules";
import { cn } from "@/lib/utils";
import { formatRentalDay } from "./rental-day";

// A rental agency's booking requests in its Pro area (audit L4-06): the ones waiting for its answer
// and the accepted rentals coming up, from its recent conversations (first inbox page), each with
// a link to its conversation. The inbox stays the place to answer.

/** Accepted rentals shown ahead: those starting within this many days. */
export const RENTAL_UPCOMING_DAYS = 14;
const UPCOMING_MAX = 5;

export interface AgencyRequests {
  pending: { cid: string; name: string; title: string; request: RentalRequestView }[];
  upcoming: { cid: string; name: string; title: string; request: RentalRequestView }[];
}

/** The agency's open requests and its accepted rentals starting within RENTAL_UPCOMING_DAYS, earliest first. */
export function agencyRequests(conversations: readonly ConversationView[], now: number): AgencyRequests {
  const today = moroccoToday(now);
  const out: AgencyRequests = { pending: [], upcoming: [] };
  for (const row of conversations) {
    if (row.role !== "seller" || row.subject !== "listing") continue;
    const base = { cid: row.cid, name: row.counterpart.displayName, title: row.listing.title };
    const current = row.rentalRequest;
    if (current?.status === "requested" && rentalRequestOpen(current, today)) out.pending.push({ ...base, request: current });
    for (const request of [current, ...(row.rentalHistory ?? [])]) {
      if (request?.status !== "accepted" || !rentalRequestOpen(request, today)) continue;
      if (dayNumber(request.from) - today <= RENTAL_UPCOMING_DAYS) out.upcoming.push({ ...base, request });
    }
  }
  const byStart = (a: { request: RentalRequestView }, b: { request: RentalRequestView }) => a.request.from.localeCompare(b.request.from);
  out.pending.sort(byStart);
  out.upcoming.sort(byStart);
  out.upcoming = out.upcoming.slice(0, UPCOMING_MAX);
  return out;
}

export function RentalRequestsPanel({ stays = false }: { stays?: boolean }) {
  const t = useTranslations("RentalAgency.requests");
  const locale = useLocale() as Locale;
  const [state, setState] = useState<AgencyRequests | "loading" | "failed">("loading");

  useEffect(() => {
    let live = true;
    fetchInbox()
      .then((page) => live && setState(agencyRequests(page.conversations, Date.now())))
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, []);

  const dates = (request: RentalRequestView) => t("dates", { from: formatRentalDay(request.from, locale), to: formatRentalDay(request.to, locale) });

  return (
    <section aria-labelledby="rental-requests" data-testid="rental-requests" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="rental-requests" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Link href="/messages" className={cn("inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-link", textLinkClassName)}>
          {t("inbox")}
          <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
        </Link>
      </header>
      {state === "loading" ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      ) : state === "failed" ? (
        <p className="text-sm text-foreground-muted">{t("loadFailed")}</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold" data-testid="rental-requests-pending" data-count={state.pending.length}>
              <Inbox aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
              {state.pending.length > 0 ? t("pending", { count: state.pending.length }) : t("noPending")}
            </h3>
            <ul className="flex flex-col gap-2">
              {state.pending.map((item) => (
                <Item key={item.cid} href={`/messages/${item.cid}`} name={item.name} title={item.title} dates={dates(item.request)} action={t("answer")} highlight />
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold" data-testid="rental-requests-upcoming" data-count={state.upcoming.length}>
              <CalendarCheck aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
              {t(stays ? "home.upcoming" : "upcoming", { days: RENTAL_UPCOMING_DAYS })}
            </h3>
            {state.upcoming.length === 0 ? <p className="text-sm text-foreground-muted">{t("noUpcoming")}</p> : null}
            <ul className="flex flex-col gap-2">
              {state.upcoming.map((item) => (
                <Item key={`${item.cid}-${item.request.id}`} href={`/messages/${item.cid}`} name={item.name} title={item.title} dates={dates(item.request)} action={t("open")} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function Item({ href, name, title, dates, action, highlight = false }: { href: string; name: string; title: string; dates: string; action: string; highlight?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        data-testid="rental-requests-item"
        className={cn(
          "flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors duration-150 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          highlight ? "border-structure/40 bg-surface-brand" : "border-border bg-surface",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{dates}</span>
          <span className="truncate text-foreground-muted">
            <bdi>{name}</bdi> · <bdi>{title}</bdi>
          </span>
        </span>
        <span className="shrink-0 font-medium text-link">{action}</span>
      </Link>
    </li>
  );
}
