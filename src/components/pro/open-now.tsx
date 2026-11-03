"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { openState } from "@/lib/pro/hours";
import type { OpeningHours } from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";

// « Ouvert jusqu'à 19:00 » / « Fermé, ouvre demain à 09:00 » on a storefront (UX audit lot 1):
// computed in the browser on Morocco's clock, refreshed every minute; nothing on the server
// render (the page is cached for minutes, the state would be stale).

const MINUTE = 60_000;
function subscribe(listener: () => void): () => void {
  const timer = window.setInterval(listener, MINUTE);
  return () => window.clearInterval(timer);
}
const nowMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

export function OpenNow({ hours }: { hours: OpeningHours }) {
  const t = useTranslations("Storefront.info");
  const at = useSyncExternalStore(subscribe, nowMinute, () => 0);
  if (at === 0) return null;
  const state = openState(hours, at);
  if (!state) return null;
  let label: string;
  if (state.open) label = t("openUntil", { time: state.until });
  else if (!state.next) label = t("closedNow");
  else if (state.next.today) label = t("closedOpensToday", { time: state.next.from });
  else label = t("closedOpensOn", { day: t(`days.${state.next.day}`), time: state.next.from });
  return (
    <p data-testid="open-now" data-open={state.open} className={cn("inline-flex items-center gap-2 self-start text-sm font-medium", state.open ? "text-success" : "text-foreground-muted")}>
      <span aria-hidden="true" className={cn("size-2 rounded-full", state.open ? "bg-success" : "bg-border-strong")} />
      {label}
    </p>
  );
}
