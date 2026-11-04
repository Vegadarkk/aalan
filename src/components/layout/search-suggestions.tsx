"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Search, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { matchSuggestions, readRecentSearches, RECENT_SEARCHES_KEY, withRecentSearch, type Suggestion } from "@/lib/search/suggest-match";
import { cn } from "@/lib/utils";

// Suggestions under the header's search words (audit §7): what the search understands (categories,
// nouns in French, Arabic and Darija, brands, car models) as the person types, and their last
// searches on this device while the field is empty. The index is fetched once per locale on the
// first focus (static, cached a day by the edge) and matched here at every key.

export type SuggestionItem = { kind: "recent"; q: string } | { kind: "suggestion"; suggestion: Suggestion };

const indexes = new Map<string, Promise<Suggestion[]>>();

/** The index of a locale, fetched once per page life; an empty one when it fails (the field stays plain). */
export function loadSuggestionIndex(locale: string): Promise<Suggestion[]> {
  let pending = indexes.get(locale);
  if (!pending) {
    pending = fetch(`/api/search/suggestions/${locale}`, { credentials: "omit" })
      .then((response) => (response.ok ? (response.json() as Promise<Suggestion[]>) : []))
      .catch(() => {
        indexes.delete(locale);
        return [];
      });
    indexes.set(locale, pending);
  }
  return pending;
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Remembers a submitted search on this device (a blocked storage keeps nothing). */
export function rememberSearch(q: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(RECENT_SEARCHES_KEY, JSON.stringify(withRecentSearch(readRecentSearches(store), q)));
  } catch {
    // Full or blocked storage: nothing to remember.
  }
}

function forgetSearches(): void {
  try {
    storage()?.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Blocked storage: nothing was kept.
  }
}

/**
 * Items for the typed words: matches of the index, or the recent searches while nothing is typed.
 * `arm` (on focus) reads the recent searches again and, the first time, loads the index.
 */
export function useSuggestionItems(locale: string, q: string): { items: SuggestionItem[]; arm: () => void; clearRecent: () => void } {
  const [armed, setArmed] = useState(false);
  const [index, setIndex] = useState<Suggestion[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (!armed) return;
    let current = true;
    void loadSuggestionIndex(locale).then((loaded) => {
      if (current) setIndex(loaded);
    });
    return () => {
      current = false;
    };
  }, [armed, locale]);
  const items = useMemo<SuggestionItem[]>(() => {
    if (!q.trim()) return recent.map((each) => ({ kind: "recent", q: each }));
    return index ? matchSuggestions(index, q).map((suggestion) => ({ kind: "suggestion", suggestion })) : [];
  }, [index, q, recent]);
  return {
    items,
    arm: () => {
      setRecent(readRecentSearches(storage()));
      setArmed(true);
    },
    clearRecent: () => {
      forgetSearches();
      setRecent([]);
    },
  };
}

export const itemKey = (item: SuggestionItem) => (item.kind === "recent" ? `r:${item.q}` : `s:${item.suggestion.kind}:${item.suggestion.label}:${item.suggestion.context ?? ""}`);

interface SuggestionListProps {
  id: string;
  items: SuggestionItem[];
  active: number;
  open: boolean;
  onActive: (index: number) => void;
  onChoose: (item: SuggestionItem) => void;
  onClearRecent: () => void;
}

export function SuggestionList({ id, items, active, open, onActive, onChoose, onClearRecent }: SuggestionListProps) {
  const t = useTranslations("Nav.suggestions");
  const recent = items[0]?.kind === "recent";
  return (
    <div
      className={cn(
        "absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-lg shadow-bab-950/10",
        "origin-top motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.98]",
        (!open || items.length === 0) && "hidden",
      )}
      // A click in the list keeps the focus (and the typed words) in the field.
      onMouseDown={(event) => event.preventDefault()}
      data-testid="search-suggestions"
    >
      {recent ? (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
          <span className="text-xs font-medium tracking-wide text-foreground-muted uppercase">{t("recent")}</span>
          <button type="button" onClick={onClearRecent} className="min-h-9 rounded-sm px-2 text-xs font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline">
            {t("clearRecent")}
          </button>
        </div>
      ) : null}
      <div id={id} role="listbox" aria-label={recent ? t("recent") : t("label")} className="flex max-h-[min(24rem,60dvh)] flex-col overflow-y-auto py-1">
        {items.map((item, index) => {
          const Icon = item.kind === "recent" ? History : item.suggestion.target && "q" in item.suggestion.target ? Search : Tag;
          const label = item.kind === "recent" ? item.q : item.suggestion.label;
          const context = item.kind === "suggestion" ? item.suggestion.context : undefined;
          return (
            <div
              key={itemKey(item)}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active || undefined}
              onClick={() => onChoose(item)}
              onMouseEnter={() => onActive(index)}
              className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 transition-colors duration-100 data-[active]:bg-surface-muted"
            >
              <Icon className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span dir="auto" className="truncate font-medium">
                  {label}
                </span>
                {context ? <span className="max-w-[55%] shrink-0 truncate text-sm text-foreground-muted">{t("in", { place: context })}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
