"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { Workload } from "@/lib/decisions/workload";
import { cn } from "@/lib/utils";

// Sections of the back office in four groups (zone 7 audit P2-7): what the team works on first
// (Modération), the accounts, the figures and procedures (Pilotage), the admin's settings
// (Réglages). A side menu from 1024 px, every section in view; below, a "Sections" button opens the
// same groups. The current section is marked, the queues carry their counters (open, and overdue
// in red).

type Counter = { count: number; overdue?: number; label: string } | null;

interface Item {
  href: string;
  label: string;
  adminOnly?: boolean;
  counter?: (counts: Workload) => Counter;
}

const sum = (counts: Workload, key: "open" | "overdue") => Object.values(counts.reports).reduce((total, priority) => total + priority[key], 0);

export const NAV_GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Modération",
    items: [
      { href: "/signalements", label: "Signalements", counter: (counts) => ({ count: sum(counts, "open"), overdue: sum(counts, "overdue"), label: "ouverts" }) },
      { href: "/moderation", label: "Annonces retenues", counter: (counts) => ({ count: counts.listingsHeld, label: "à vérifier" }) },
      { href: "/recours", label: "Recours", counter: (counts) => ({ count: counts.appeals.open, overdue: counts.appeals.overdue, label: "ouverts" }) },
    ],
  },
  {
    label: "Comptes",
    items: [
      { href: "/comptes", label: "Comptes" },
      { href: "/pros", label: "Comptes Pro", counter: (counts) => ({ count: counts.proRequests, label: "demandes à vérifier" }) },
    ],
  },
  {
    label: "Pilotage",
    items: [
      { href: "/statistiques", label: "Statistiques" },
      { href: "/guide", label: "Guide démarches" },
      { href: "/ventes", label: "Ventes", adminOnly: true },
      { href: "/autorites", label: "Autorités", adminOnly: true, counter: (counts) => ({ count: counts.authoritiesOpen, label: "en cours" }) },
    ],
  },
  {
    label: "Réglages",
    items: [
      { href: "/personnel", label: "Personnel", adminOnly: true },
      { href: "/parametres/legal", label: "Mentions légales", adminOnly: true },
      { href: "/parametres/paiements", label: "Paiement vendeur", adminOnly: true },
      { href: "/parametres/quotas", label: "Quotas", adminOnly: true },
    ],
  },
];

/** Pages reached from a section without being listed (a decision opens from the reports and the appeals). */
const PARENT: Record<string, string> = { "/decisions": "/signalements", "/conversations": "/signalements" };

/** The listed section a path belongs to ("/" for the home), or null. */
export function currentSection(pathname: string, admin: boolean): string | null {
  if (pathname === "/") return "/";
  const section = Object.entries(PARENT).find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? pathname;
  const items = NAV_GROUPS.flatMap((group) => group.items).filter((item) => admin || !item.adminOnly);
  return items.find((item) => section === item.href || section.startsWith(`${item.href}/`))?.href ?? null;
}

function CounterPill({ counter }: { counter: Counter }) {
  if (!counter || counter.count === 0) return null;
  const late = (counter.overdue ?? 0) > 0;
  return (
    <span
      className={cn(
        "ms-auto inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs leading-5 font-semibold tabular-nums",
        late ? "bg-danger text-danger-foreground" : "bg-surface-muted text-foreground-muted ring-1 ring-border ring-inset",
      )}
    >
      <span aria-hidden="true">{counter.count > 999 ? "999+" : counter.count}</span>
      <span className="sr-only">
        , {counter.count} {counter.label}
        {late ? ` dont ${counter.overdue} en retard` : ""}
      </span>
    </span>
  );
}

function Groups({ admin, counts, current, onNavigate, className }: { admin: boolean; counts: Workload | null; current: string | null; onNavigate?: () => void; className?: string }) {
  const baseId = useId();
  return (
    <div className={className}>
      <Link
        href="/"
        onClick={onNavigate}
        aria-current={current === "/" ? "page" : undefined}
        className={linkClass}
      >
        Tableau de bord
      </Link>
      {NAV_GROUPS.map((group, index) => {
        const items = group.items.filter((item) => admin || !item.adminOnly);
        if (items.length === 0) return null;
        const id = `${baseId}-group-${index}`;
        return (
          <div key={group.label} role="group" aria-labelledby={id} className="flex flex-col">
            <p id={id} className="px-3 pt-4 pb-1 text-xs font-medium text-foreground-muted">
              {group.label}
            </p>
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={onNavigate} aria-current={current === item.href ? "page" : undefined} className={linkClass}>
                    <span className="truncate">{item.label}</span>
                    {counts && item.counter ? <CounterPill counter={item.counter(counts)} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const linkClass = cn(
  "relative flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground",
  "before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-full before:bg-primary before:opacity-0",
  "aria-[current=page]:bg-surface-muted aria-[current=page]:text-foreground aria-[current=page]:before:opacity-100",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
);

/** The side menu (from `lg`): sticky under the header, scrolling on its own on a short screen. */
export function AdminSideNav({ admin, counts }: { admin: boolean; counts: Workload | null }) {
  const current = currentSection(usePathname(), admin);
  return (
    <nav aria-label="Sections du back-office" className="sticky top-0 hidden max-h-dvh w-56 shrink-0 overflow-y-auto border-e border-border py-4 pe-3 lg:block">
      <Groups admin={admin} counts={counts} current={current} />
    </nav>
  );
}

/** Below `lg`: one button naming the current section, opening the groups in a panel. */
export function AdminMenuButton({ admin, counts }: { admin: boolean; counts: Workload | null }) {
  const pathname = usePathname();
  const current = currentSection(pathname, admin);
  // Open on the path it was opened on: any navigation (a link, back, forward) closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const label = current === "/" ? "Tableau de bord" : (NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === current)?.label ?? "Sections");
  const counters = counts ? NAV_GROUPS.flatMap((group) => group.items).filter((item) => (admin || !item.adminOnly) && item.counter) : [];
  const late = counts ? counters.some((item) => (item.counter?.(counts)?.overdue ?? 0) > 0) : false;
  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center gap-2 text-start text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="text-foreground-muted">Sections</span>
        <span className="truncate text-foreground">{label}</span>
        {late ? (
          <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden="true" />
        ) : null}
        {late ? <span className="sr-only">, des signalements ou recours sont en retard</span> : null}
        <ChevronDown aria-hidden="true" className={cn("ms-auto size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <nav id={panelId} aria-label="Sections du back-office" hidden={!open} className="border-t border-border pb-3">
        <Groups admin={admin} counts={counts} current={current} onNavigate={() => setOpen(false)} className="grid gap-x-6 sm:grid-cols-2 sm:[&>a]:col-span-2" />
      </nav>
    </div>
  );
}
