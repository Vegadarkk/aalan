import type { Metadata } from "next";
import Link from "next/link";
import { REPORT_PRIORITIES } from "@/config/report-reasons";
import { Badge } from "@/components/ui/badge";
import { requirePageStaff } from "@/lib/auth/current-user";
import { activityKind, activityShown } from "@/lib/decisions/activity";
import { staffActivity, workload, type StaffActivity, type Workload } from "@/lib/decisions/workload";
import { targetSummaries, type TargetSummary } from "@/lib/reports/summaries";
import { cn } from "@/lib/utils";
import { decisionTargetHref, formatDateTime, plural, PRIORITY_DELAY, PRIORITY_EDGE, PRIORITY_TONE, TARGET_LABEL, targetHref } from "../_lib/moderation-format";
import { waitingFor } from "../_components/moderation-labels";
import { linkClassName, Panel } from "../_components/panel";

// Home of the back office (zone 7 audit P2-6): what waits for the team, most urgent first. Open
// and overdue reports per priority, then the other queues (held listings, appeals, Pro requests,
// authority requests for admins), then the team's latest actions. The figures come from the
// one-minute workload cache; the free-quota board moved to Réglages › Quotas (admins).

export const metadata: Metadata = { title: "Tableau de bord" };

interface Queue {
  href: string;
  label: string;
  count: number;
  /** "à vérifier", "ouverts"... after the count. */
  unit: [string, string];
  overdue?: number;
  adminOnly?: boolean;
}

function queues(counts: Workload): Queue[] {
  return [
    { href: "/moderation", label: "Annonces retenues", count: counts.listingsHeld, unit: ["à vérifier", "à vérifier"] },
    { href: "/recours", label: "Recours", count: counts.appeals.open, unit: ["ouvert", "ouverts"], overdue: counts.appeals.overdue },
    { href: "/pros", label: "Demandes Pro", count: counts.proRequests, unit: ["à vérifier", "à vérifier"] },
    { href: "/autorites", label: "Demandes d'autorités", count: counts.authoritiesOpen, unit: ["en cours", "en cours"], adminOnly: true },
  ];
}

/** Where an audited action's target is examined. */
function activityHref(entry: StaffActivity): string | null {
  const { type, id } = entry.target;
  if (type === "listing") return entry.action.startsWith("listing.approve") || entry.action.startsWith("listing.reject") ? `/moderation/${id}` : targetHref(`listing:${id}`);
  if (type === "user") return decisionTargetHref({ type, id });
  if (type === "pro") return `/pros/${id}`;
  if (type === "decision") return `/decisions/${id}`;
  if (type === "authorityRequest") return `/autorites/${id}`;
  if (type === "message" || type === "review") return targetHref(`${type}:${id}`);
  return null;
}

function activityTarget(entry: StaffActivity, summary: TargetSummary | undefined): string {
  const { type, id } = entry.target;
  if (summary?.listing) return `« ${summary.listing.title || "Sans titre"} »`;
  if (summary?.account) return summary.account.displayName;
  if (summary?.shop) return summary.shop.name;
  if (type === "decision") return "la décision";
  if (type === "authorityRequest") return "la demande";
  return `${TARGET_LABEL[type] ?? type} ${id}`;
}

function PriorityRows({ counts }: { counts: Workload }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {REPORT_PRIORITIES.map((priority) => {
        const { open, overdue } = counts.reports[priority];
        return (
          <li key={priority}>
            <Link
              href={`/signalements?priorite=${priority}`}
              className={cn(
                "relative grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 py-3 ps-4 pe-2 before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full",
                PRIORITY_EDGE[priority],
                "rounded-sm transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              <Badge variant={PRIORITY_TONE[priority]} className="justify-center tabular-nums">
                {priority}
              </Badge>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{open === 0 ? "Aucun signalement ouvert" : plural(open, "signalement ouvert", "signalements ouverts")}</span>
                <span className="text-xs text-foreground-muted">Délai cible {PRIORITY_DELAY[priority]}</span>
              </span>
              {overdue > 0 ? (
                <span className="text-sm font-semibold text-danger tabular-nums">{plural(overdue, "en retard", "en retard")}</span>
              ) : (
                <span className="text-sm text-foreground-muted">{open > 0 ? "Dans les délais" : ""}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function AdminHome() {
  const staff = await requirePageStaff();
  const admin = staff.role === "admin";
  const [counts, activity] = await Promise.all([workload(), staffActivity()]);
  const shown = (activity ?? []).filter((entry) => activityShown(entry.action, admin)).slice(0, 8);
  const summaries = await targetSummaries(shown.flatMap((entry) => (["listing", "user", "pro"].includes(entry.target.type) ? [{ key: `${entry.target.type}:${entry.target.id}` }] : [])));
  const overdue = counts ? Object.values(counts.reports).reduce((total, priority) => total + priority.overdue, 0) : 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="mt-1 max-w-prose text-sm text-foreground-muted">
            {counts === null
              ? "Les chiffres sont momentanément indisponibles : ouvrez les files depuis le menu."
              : overdue > 0
                ? `${plural(overdue, "signalement a dépassé", "signalements ont dépassé")} son délai : commencez par là.`
                : "Aucun signalement en retard."}
          </p>
        </div>
        {counts ? (
          <p className="text-xs text-foreground-muted">
            Chiffres de <time dateTime={counts.generatedAt}>{formatDateTime(counts.generatedAt)}</time>, actualisés chaque minute
          </p>
        ) : null}
      </div>

      {counts ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
          <Panel title="Signalements par priorité" meta={<Link href="/signalements" className={linkClassName}>Toute la file</Link>}>
            <PriorityRows counts={counts} />
          </Panel>
          <Panel title="Autres files">
            <ul className="flex flex-col divide-y divide-border">
              {queues(counts)
                .filter((queue) => admin || !queue.adminOnly)
                .map((queue) => (
                  <li key={queue.href}>
                    <Link href={queue.href} className="flex items-center justify-between gap-3 rounded-sm py-3 pe-2 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      <span className="text-sm font-medium text-foreground">{queue.label}</span>
                      <span className="flex items-baseline gap-2 text-sm tabular-nums">
                        {queue.overdue ? <span className="font-semibold text-danger">{queue.overdue} en retard</span> : null}
                        <span className={queue.count > 0 ? "text-foreground" : "text-foreground-muted"}>
                          {queue.count === 0 ? "Aucun" : `${queue.count} ${queue.count > 1 ? queue.unit[1] : queue.unit[0]}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      <Panel title="Dernière activité de l'équipe" meta={activity === null ? "Indisponible" : null}>
        {shown.length === 0 ? (
          <p className="text-sm text-foreground-muted">{activity === null ? "Le journal ne répond pas pour le moment." : "Aucune décision de l'équipe récemment."}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border" aria-label="Actions récentes, les plus récentes en premier">
            {shown.map((entry, index) => {
              const href = activityHref(entry);
              const target = activityTarget(entry, summaries[`${entry.target.type}:${entry.target.id}`]);
              return (
                <li key={`${entry.at}-${index}`} className="grid gap-x-4 gap-y-0.5 py-2.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <time dateTime={entry.at} title={formatDateTime(entry.at)} className="text-foreground-muted tabular-nums">
                    {waitingFor(entry.at)}
                  </time>
                  <p className="min-w-0">
                    <span className="font-medium">{entry.actor ?? "Membre retiré de l'équipe"}</span>
                    <span className="text-foreground-muted"> ({entry.actorRole === "admin" ? "admin" : "modérateur"}) : </span>
                    {activityKind(entry.action)?.label}
                    {", "}
                    {href ? (
                      <Link href={href} dir="auto" className={linkClassName}>
                        {target}
                      </Link>
                    ) : (
                      <span dir="auto">{target}</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
