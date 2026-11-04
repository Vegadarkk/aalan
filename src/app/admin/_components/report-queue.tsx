"use client";

import { ImageOff, MessageSquare, Star, Store, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReportQueueGroup, ReportQueueItem } from "@/lib/reports/admin";
import { cn } from "@/lib/utils";
import type { TargetCard } from "../_lib/target-cards";
import { CopyReference } from "./copy-reference";
import { orderByUrgency, plural, PRIORITY_EDGE, PRIORITY_TONE, prioritySla, reasonLabel, REPORTER_LABEL, SIGNAL_LABEL, TARGET_LABEL, targetHref } from "../_lib/moderation-format";
import { SlaTimer, useNow } from "./sla-timer";

/** How the queue names a target without reading it (the target view shows the content). */
export function targetName(item: Pick<ReportQueueItem, "target">): string {
  const { target } = item;
  if (target.type === "user") return `Compte ${target.publicId ?? target.id}`;
  if (target.type === "message") return target.listingId ? `Message, conversation de l'annonce ${target.listingId}` : "Message";
  if (target.type === "review") return target.listingId ? `Avis sur un échange, annonce ${target.listingId}` : "Avis";
  return `${TARGET_LABEL[target.type] ?? target.type} ${target.id}`;
}

/** "Arnaque ou escroquerie (2), Contrefaçon": the group's reasons, most reported first. */
export function reasonSummary(reports: readonly Pick<ReportQueueItem, "reasonId">[]): string {
  const counts = new Map<string, number>();
  for (const report of reports) counts.set(report.reasonId, (counts.get(report.reasonId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => (count > 1 ? `${reasonLabel(id)} (${count})` : reasonLabel(id)))
    .join(", ");
}

function Signals({ reports }: { reports: readonly ReportQueueItem[] }) {
  const badges: { label: string; tone: "danger" | "warning" | "neutral" }[] = [];
  if (reports.some((report) => report.hidden)) badges.push({ label: "Masqué en attente", tone: "warning" });
  for (const signal of new Set(reports.flatMap((report) => (report.strongSignal ? [report.strongSignal] : [])))) badges.push({ label: `Signal fort : ${SIGNAL_LABEL[signal]?.toLowerCase() ?? signal}`, tone: "danger" });
  for (const kind of new Set(reports.map((report) => report.reporter.kind))) {
    if (kind === "system" || kind === "authority") badges.push({ label: REPORTER_LABEL[kind], tone: "neutral" });
  }
  if (reports.some((report) => report.aiDecisionId)) badges.push({ label: "Proposition de l'agent", tone: "neutral" });
  if (badges.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Signaux">
      {badges.map((badge) => (
        <li key={badge.label}>
          <Badge variant={badge.tone}>{badge.label}</Badge>
        </li>
      ))}
    </ul>
  );
}

interface ReportQueueProps {
  items: ReportQueueItem[];
  groups: ReportQueueGroup[];
  /** Server time of the render (ISO): the timers start from it. */
  renderedAt: string;
  /** What each target is (title, seller, price, city, photo) by target key; absent: its reference only. */
  cards?: Record<string, TargetCard>;
}

const KIND_ICON: Record<string, LucideIcon> = { Annonce: ImageOff, Compte: UserRound, Message: MessageSquare, Boutique: Store, Avis: Star };

/** First photo of the target, or a quiet tile with the icon of its kind. */
function Thumb({ card }: { card: TargetCard }) {
  const Icon = KIND_ICON[card.kind] ?? ImageOff;
  return (
    <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted text-foreground-muted">
      {/* eslint-disable-next-line @next/next/no-img-element -- media variants are served as is (images.unoptimized, design §8) */}
      {card.thumb ? <img src={card.thumb.src} alt="" width={56} height={56} loading="lazy" decoding="async" className="size-full object-cover" /> : <Icon aria-hidden="true" className="size-5" />}
    </div>
  );
}

/**
 * Open reports grouped by target (one decision closes a group, D13), past due first, then by
 * priority and due date; the timers and the order follow the clock without a reload.
 */
export function ReportQueue({ items, groups, renderedAt, cards = {} }: ReportQueueProps) {
  const now = useNow(renderedAt);
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <ol aria-label="Cibles signalées, les plus urgentes en premier" className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {orderByUrgency(groups, now).map((group) => {
        const reports = group.reportIds.flatMap((id) => byId.get(id) ?? []);
        const first = reports[0];
        if (!first) return null;
        const href = targetHref(group.targetKey);
        const card = cards[group.targetKey];
        const name = card ? `${card.kind} : ${card.title}` : targetName(first);
        const excerpt = reports.find((report) => report.excerpt.trim())?.excerpt;
        const late = Date.parse(group.slaDueAt) < now.getTime();
        return (
          <li
            key={group.targetKey}
            data-target={group.targetKey}
            className={cn(
              "relative grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-3 py-4 ps-5 pe-4 before:absolute before:inset-y-0 before:start-0 before:w-1 md:grid-cols-[6rem_minmax(0,1fr)_auto]",
              PRIORITY_EDGE[group.priority],
              late && "bg-danger-surface/40",
            )}
          >
            <div className="flex flex-col items-start gap-1.5">
              <Badge variant={PRIORITY_TONE[group.priority]} className="tabular-nums">
                {group.priority}
              </Badge>
              <span className="text-xs text-foreground-muted">{plural(reports.length, "signalement", "signalements")}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              {card ? (
                <div className="flex min-w-0 items-start gap-3">
                  <Thumb card={card} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link href={href} dir="auto" className="truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline">
                      <span className="text-foreground-muted">{card.kind} </span>
                      {card.title}
                    </Link>
                    {card.details.length > 0 ? <p className="truncate text-sm text-foreground-muted">{card.details.join(", ")}</p> : null}
                    <CopyReference value={card.reference} />
                  </div>
                </div>
              ) : (
                <Link href={href} className="truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline">
                  {name}
                </Link>
              )}
              <p className="text-sm text-foreground">{reasonSummary(reports)}</p>
              {excerpt ? (
                <p dir="auto" className="line-clamp-2 max-w-prose text-sm text-foreground-muted">
                  « {excerpt} »
                </p>
              ) : null}
              <Signals reports={reports} />
            </div>
            <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 md:col-span-1 md:flex-col md:items-end md:justify-start">
              <SlaTimer dueAt={group.slaDueAt} now={now} windowMs={prioritySla(group.priority)} className="md:flex-col md:items-end" />
              <Button asChild variant={late || group.priority === "P0" ? "primary" : "outline"} size="sm">
                <Link href={href} aria-label={`Examiner : ${name}`}>
                  Examiner
                </Link>
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
