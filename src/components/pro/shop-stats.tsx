"use client";

import { useEffect, useState } from "react";
import { Eye, LayoutGrid, MessageSquare, Phone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { apiGet } from "@/lib/auth/client";
import { PRO_API, type ShopStatsResponse, type ShopStatsTotals } from "@/lib/contracts/pro";
import { isolate } from "@/lib/i18n/bidi";
import { formatDate, groupDigits } from "@/lib/listings/client/format";
import { cn } from "@/lib/utils";

// The shop's counters in the Pro space (UX audit of the Pro shops, lot 1; src/lib/stats): views of
// the storefront and of the listings, conversations started, numbers revealed, over the last 7 or
// 30 days, and the most viewed listings. Written each night: the note says up to which day.

type Period = "last7" | "last30";

const TILES: { key: keyof ShopStatsTotals; icon: typeof Eye }[] = [
  { key: "storefrontViews", icon: Eye },
  { key: "listingViews", icon: LayoutGrid },
  { key: "contacts", icon: MessageSquare },
  { key: "reveals", icon: Phone },
];

export function ShopStats() {
  const t = useTranslations("Pro.stats");
  const locale = useLocale() as Locale;
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; stats: ShopStatsResponse } | { kind: "error" }>({ kind: "loading" });
  const [period, setPeriod] = useState<Period>("last30");

  useEffect(() => {
    let live = true;
    apiGet<ShopStatsResponse>(PRO_API.stats)
      .then((stats) => live && setState({ kind: "ready", stats }))
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, []);

  const count = (value: number) => groupDigits(String(value)) || "0";
  const stats = state.kind === "ready" ? state.stats : null;
  const totals = stats?.[period];

  return (
    <section data-testid="shop-stats" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5" aria-labelledby="pro-stats">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pro-stats" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <div role="radiogroup" aria-label={t("period")} className="inline-flex rounded-md border border-border bg-surface-muted p-0.5">
          {(["last7", "last30"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "min-h-9 rounded-[5px] px-3 text-sm font-medium transition-colors duration-150",
                period === value ? "bg-surface text-foreground shadow-sm" : "text-foreground-muted hover:text-foreground",
              )}
            >
              {t(value)}
            </button>
          ))}
        </div>
      </div>

      {state.kind === "error" ? (
        <p className="text-sm text-foreground-muted text-pretty">{t("unavailable")}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {TILES.map(({ key, icon: Icon }) => (
            <div key={key} className="flex flex-col gap-1.5 rounded-md bg-surface-muted p-4">
              <dt className="flex items-center gap-1.5 text-sm text-foreground-muted">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(`tiles.${key}`)}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums" data-testid={`stat-${key}`}>
                {totals ? count(totals[key]) : <Skeleton className="h-8 w-16" />}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {stats && stats.topListings.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("topTitle")}</h3>
          <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
            {stats.topListings.map((listing) => (
              <li key={listing.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                {listing.slugId && listing.title ? (
                  <Link href={`/annonce/${listing.slugId}`} prefetch={false} dir="auto" className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {listing.title}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-foreground-muted">{t("gone")}</span>
                )}
                <span className="shrink-0 text-foreground-muted tabular-nums">{t("topCounts", { views: listing.views, contacts: listing.contacts })}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="text-xs text-foreground-muted text-pretty">
        {stats ? t("note", { date: isolate(formatDate(new Date(`${stats.through}T12:00:00Z`), locale)) }) : t("noteLoading")}
      </p>
    </section>
  );
}
