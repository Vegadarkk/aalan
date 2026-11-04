"use client";

import { startTransition, useOptimistic } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { SearchParams } from "@/lib/search/params";
import { cn } from "@/lib/utils";
import { quickConditionOf, quickConditions, searchLinkHref, type QuickCondition } from "./filter-model";
import { useSearchNavigation } from "./search-navigation";

// « Tout / Neuf / Occasion » quick switch of the results (audit §7): one tap instead of the five
// conditions of the filters sheet. Real links (new tab, no-JS); a plain click runs the search
// navigation and shows the picked value at once (optimistic, like the sort). Hidden where the
// scope has no condition (real estate, jobs, services, rentals).

function plainClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function ConditionSwitch({ params, className }: { params: SearchParams; className?: string }) {
  const t = useTranslations("SearchFilters.quickCondition");
  const navigation = useSearchNavigation();
  const choices = quickConditions(params);
  const [shown, setShown] = useOptimistic<QuickCondition | null>(quickConditionOf(params));
  if (choices.length === 0) return null;
  return (
    <nav aria-label={t("label")} data-testid="condition-switch" className={cn("inline-flex h-11 shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface p-1", className)}>
      {choices.map(({ value, params: next }) => {
        const selected = shown === value;
        return (
          <Link
            key={value}
            href={searchLinkHref(next)}
            prefetch={false}
            scroll={false}
            aria-current={selected ? "true" : undefined}
            onClick={(event) => {
              if (!navigation || !plainClick(event)) return;
              event.preventDefault();
              if (selected) return;
              startTransition(() => {
                setShown(value);
                navigation.navigate(next, { scroll: false });
              });
            }}
            className={cn(
              "inline-flex h-full items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-[background-color,color] duration-150 ease-door",
              selected ? "bg-surface-brand text-structure dark:bg-bab-700 dark:text-cream-100" : "text-foreground-muted hover:text-foreground",
            )}
          >
            {t(value)}
          </Link>
        );
      })}
    </nav>
  );
}
