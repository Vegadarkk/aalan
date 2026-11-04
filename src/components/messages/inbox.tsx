"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AppWindow, Ban, CloudOff, Lock, MailOpen, RefreshCw, ShieldAlert, UserX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { EmptyState } from "@/components/feedback/empty-state";
import { Select } from "@/components/post/controls/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { LIVE_STREAMS_PER_ACCOUNT } from "@/lib/contracts/endpoints";
import { appointmentEventOf, type AppointmentEvent } from "@/lib/contracts/appointments";
import { HIDDEN_MARKER, URL_MARKER, type ConversationView } from "@/lib/contracts/messaging";
import { rentalRequestEventOf, type RentalRequestEvent } from "@/lib/contracts/rental-requests";
import { offerEventOf, type OfferEvent } from "@/lib/offers/rules";
import { cn } from "@/lib/utils";
import { formatRowTime } from "./format";
import { NO_FILTER, effectiveFilter, filterRows, listingChoices, shouldLoadMore, unreadConversations, type InboxFilter } from "./inbox-state";
import { ListingDoor } from "./listing-door";
import { useMessages } from "./messages-provider";

// The conversation list (design phase-5 D2): inbox or archived view, newest activity first, with
// the listing, the other participant, the last message and the unread count. Pages load as the end
// of the list comes into view; a page can hold no row of this view, so loading goes on until the
// end is off screen or the last page is in. Filters « Non lues » and « Par annonce » (audit §7) sort
// the rows loaded so far; the end of a short filtered list is on screen, so the next pages load.

/** The last message as one line: moderation and masked links in words ("Vous :" is set apart). */
export function previewText(
  row: Pick<ConversationView, "lastMessage">,
  labels: {
    hidden: string;
    maskedLink: string;
    appointment?: (event: AppointmentEvent) => string;
    rentalRequest?: (event: RentalRequestEvent) => string;
    offer?: (event: OfferEvent) => string;
  },
): string {
  const { preview } = row.lastMessage;
  const step = appointmentEventOf(preview);
  if (step && labels.appointment) return labels.appointment(step);
  const rental = rentalRequestEventOf(preview);
  if (rental && labels.rentalRequest) return labels.rentalRequest(rental);
  const offer = offerEventOf(preview);
  if (offer && labels.offer) return labels.offer(offer);
  return preview === HIDDEN_MARKER ? labels.hidden : preview.split(URL_MARKER).join(labels.maskedLink).replace(/\s+/g, " ").trim();
}

/** Path of a conversation, keeping the archived view. */
export function threadHref(cid: string, archived: boolean): string {
  return archived ? `/messages/${cid}?archived=1` : `/messages/${cid}`;
}

function ConversationRow({ row, selected, archived, now }: { row: ConversationView; selected: boolean; archived: boolean; now: number }) {
  const t = useTranslations("Messaging.row");
  const risk = useTranslations("Messaging.risk");
  const locale = useLocale() as Locale;
  const unread = row.unread > 0;
  const appointment = useTranslations("Appointments.preview");
  const rentalRequest = useTranslations("RentalRequest.preview");
  const offer = useTranslations("Offers.preview");
  const preview = previewText(row, {
    hidden: t("hidden"),
    maskedLink: t("maskedLink"),
    appointment: (event) => appointment(event),
    // A stay reads « Demande de séjour » (audit L4-06): the conversation's request tells the unit.
    rentalRequest: (event) => rentalRequest(row.rentalRequest?.unit === "night" ? `home.${event}` : event),
    offer: (event) => offer(event),
  });
  return (
    <li>
      <Link
        href={threadHref(row.cid, archived)}
        aria-current={selected ? "page" : undefined}
        data-testid="conversation-row"
        data-unread={row.unread}
        className={cn(
          "group flex gap-3 border-s-[3px] border-transparent px-4 py-3 outline-offset-[-2px] transition-colors duration-150 hover:bg-surface-muted",
          "aria-[current=page]:border-featured aria-[current=page]:bg-surface-muted",
        )}
      >
        <ListingDoor conversation={row} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span dir="auto" className={cn("min-w-0 truncate", unread ? "font-semibold" : "font-medium")}>
              {row.counterpart.displayName}
            </span>
            <time dateTime={new Date(row.lastMessage.at).toISOString()} className={cn("ms-auto shrink-0 text-xs tabular-nums", unread ? "font-semibold text-primary" : "text-foreground-muted")}>
              {formatRowTime(row.lastMessage.at, now, locale, t("yesterday"))}
            </time>
          </span>
          <span dir="auto" className="truncate text-sm text-foreground-muted">
            {row.listing.title}
          </span>
          <span className="flex items-center gap-2">
            {row.lastMessage.flagged && !row.lastMessage.mine ? (
              <ShieldAlert className="size-3.5 shrink-0 text-warning" aria-label={risk("title")} role="img" />
            ) : null}
            <span className={cn("flex min-w-0 flex-1 items-baseline gap-1 text-sm", unread ? "font-medium text-foreground" : "text-foreground-muted")}>
              {/* Its own box: a preview in the other script direction then truncates at its own end. */}
              {row.lastMessage.mine ? <span className="shrink-0">{t("you")}</span> : null}
              <span dir="auto" className="min-w-0 truncate">
                {preview}
              </span>
            </span>
            {row.counterpartClosed ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-surface-muted px-1.5 text-xs text-foreground-muted group-aria-[current=page]:bg-surface">
                <UserX className="size-3" aria-hidden="true" />
                {t("closed")}
              </span>
            ) : row.blockedByMe || row.blockedMe ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-surface-muted px-1.5 text-xs text-foreground-muted group-aria-[current=page]:bg-surface">
                <Ban className="size-3" aria-hidden="true" />
                {t("blocked")}
              </span>
            ) : row.frozen ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-warning-surface px-1.5 text-xs text-warning">
                <Lock className="size-3" aria-hidden="true" />
                {t("frozen")}
              </span>
            ) : null}
            {unread ? (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
                <span aria-hidden="true">{row.unread > 99 ? "99+" : row.unread}</span>
                <span className="sr-only">{t("unread", { count: row.unread })}</span>
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function RowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul role="status" aria-busy="true" className="flex flex-col">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex gap-3 px-4 py-3">
          <Skeleton className="h-14 w-12 rounded-t-full rounded-b-md" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** True while `target` is on screen. */
function useOnScreen(target: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!active || !element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), { rootMargin: "200px 0px" });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setVisible(false);
    };
  }, [target, active]);
  return visible;
}

/** « Non lues » and the listing picker, under the views. The picker shows from two listings on. */
function InboxFilters({ rows, filter, onChange }: { rows: readonly ConversationView[]; filter: InboxFilter; onChange: (filter: InboxFilter) => void }) {
  const t = useTranslations("Messaging.filters");
  const choices = listingChoices(rows);
  const unread = unreadConversations(rows);
  return (
    <div role="group" aria-label={t("label")} data-testid="inbox-filters" className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        aria-pressed={filter.unread}
        onClick={() => onChange({ ...filter, unread: !filter.unread })}
        data-testid="filter-unread"
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-[background-color,border-color,color] duration-150 ease-door max-sm:h-11",
          filter.unread ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground-muted hover:text-foreground",
        )}
      >
        <MailOpen className="size-4" aria-hidden="true" />
        {t("unread")}
        {unread > 0 ? <span className={cn("tabular-nums", filter.unread ? "text-primary-foreground/85" : "text-foreground-muted")}>{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {choices.length > 1 ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="inbox-listing-filter" className="sr-only">
            {t("listing")}
          </label>
          <Select
            id="inbox-listing-filter"
            data-testid="filter-listing"
            value={filter.listingId ?? ""}
            onChange={(event) => onChange({ ...filter, listingId: event.target.value || null })}
            className="h-9 w-full min-w-0 truncate rounded-full border-border bg-surface py-0 text-sm max-sm:h-11"
          >
            <option value="">{t("allListings")}</option>
            {choices.map((choice) => (
              <option key={choice.listingId} value={choice.listingId}>
                {t("listingOption", { title: choice.title || t("untitled"), count: choice.count })}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </div>
  );
}

export function Inbox({ selected }: { selected: string | null }) {
  const t = useTranslations("Messaging.page");
  const apiMessage = useApiErrorMessage();
  const { archived, inbox, live, loadMore, retry, refreshLive } = useMessages();
  const end = useRef<HTMLDivElement>(null);
  const ready = inbox.kind === "ready";
  const endVisible = useOnScreen(end, ready && Boolean(inbox.next));
  // Rendering time for the row dates, refreshed every minute ("Hier" after midnight).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Filters of the current view: a switch to the other view starts unfiltered.
  const [filtered, setFiltered] = useState<{ archived: boolean; filter: InboxFilter }>({ archived, filter: NO_FILTER });
  const chosen = filtered.archived === archived ? filtered.filter : NO_FILTER;
  const setFilter = (filter: InboxFilter) => setFiltered({ archived, filter });
  const loadedRows = inbox.kind === "ready" ? inbox.rows : [];
  const filter = effectiveFilter(chosen, loadedRows);
  const shownRows = filterRows(loadedRows, filter, selected);

  const wantsMore = inbox.kind === "ready" && shouldLoadMore(inbox, endVisible);
  useEffect(() => {
    if (wantsMore) loadMore();
  }, [wantsMore, loadMore]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 pt-4 pb-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <nav aria-label={t("views")} className="flex gap-1 rounded-full bg-surface-muted p-1 text-sm font-medium">
          {[
            { href: "/messages", label: t("inbox"), current: !archived },
            { href: "/messages?archived=1", label: t("archived"), current: archived },
          ].map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.current ? "page" : undefined}
              className="flex min-h-9 flex-1 items-center justify-center rounded-full px-3 text-foreground-muted transition-colors duration-150 hover:text-foreground aria-[current=page]:bg-surface aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {inbox.kind === "ready" && inbox.rows.length > 0 ? <InboxFilters rows={inbox.rows} filter={filter} onChange={setFilter} /> : null}
        {/* One live region for both notices: a busy tab is not offline (audit zone 5 n°7). */}
        <div role="status" className="empty:hidden">
          {live.status === "busy" ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="live-busy">
              <p className="flex min-w-0 flex-1 basis-56 items-start gap-2 text-xs text-foreground-muted text-pretty">
                <AppWindow className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {t("busy", { count: LIVE_STREAMS_PER_ACCOUNT })}
              </p>
              <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={refreshLive}>
                <RefreshCw aria-hidden="true" />
                {t("refreshLive")}
              </Button>
            </div>
          ) : live.status === "down" ? (
            <p className="flex items-start gap-2 text-xs text-foreground-muted text-pretty">
              <CloudOff className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {t("offline")}
            </p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="inbox">
        {inbox.kind === "loading" ? (
          <div aria-label={t("loading")}>
            <RowsSkeleton />
          </div>
        ) : inbox.kind === "failed" ? (
          <div className="p-4">
            <FormMessage
              error={inbox.error}
              title={t("loadFailedTitle")}
              action={
                <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={retry}>
                  {t("retry")}
                </Button>
              }
            >
              {apiMessage(inbox.error)}
            </FormMessage>
          </div>
        ) : inbox.rows.length === 0 && !inbox.next ? (
          archived ? (
            <EmptyState
              title={t("archivedEmptyTitle")}
              action={
                <Button asChild variant="outline">
                  <Link href="/messages">{t("inbox")}</Link>
                </Button>
              }
            >
              {t("archivedEmptyBody")}
            </EmptyState>
          ) : (
            <EmptyState
              title={t("emptyTitle")}
              action={
                <Button asChild>
                  <Link href="/recherche">{t("browse")}</Link>
                </Button>
              }
            >
              {t("emptyBody")}
            </EmptyState>
          )
        ) : (
          <>
            {shownRows.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border/70">
                {shownRows.map((row) => (
                  <ConversationRow key={row.cid} row={row} selected={row.cid === selected} archived={archived} now={now} />
                ))}
              </ul>
            ) : inbox.rows.length > 0 && !inbox.next ? (
              <EmptyState
                title={filter.unread && !filter.listingId ? t("filteredUnreadTitle") : t("filteredTitle")}
                action={
                  <Button type="button" variant="outline" onClick={() => setFilter(NO_FILTER)}>
                    {t("showAll")}
                  </Button>
                }
              >
                {t("filteredBody")}
              </EmptyState>
            ) : null}
            {inbox.next ? (
              <div ref={end} className="flex justify-center px-4 py-4">
                {inbox.more === "failed" ? (
                  <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={loadMore}>
                    {t("retry")}
                  </Button>
                ) : inbox.rows.length === 0 || inbox.more === "loading" ? (
                  <div className="w-full" aria-label={t("loading")}>
                    <RowsSkeleton count={2} />
                  </div>
                ) : (
                  <Button type="button" variant="ghost" size="sm" className="max-sm:h-11" onClick={loadMore}>
                    {t("more")}
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
