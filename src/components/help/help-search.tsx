"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { inputClassName } from "@/components/ui/input";
import { quietLinkClassName } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import { useNumbersTranslations } from "@/i18n/numbers";
import { matchHelp, queryTokens, type HelpEntry } from "@/lib/help/match";
import { cn } from "@/lib/utils";
import { HELP_QUERY_MAX, hashForQuery, queryFromHash } from "./help-search-url";

// Search box of /aide (design phase-5 D25): filters the locale's articles in the browser (titles,
// summaries, search terms: a few kilobytes, no request). While a query is typed, the results
// replace the theme listing passed as children. The query sits in the address (#q=, audit zone 5
// n°19): a shared or reloaded link shows the same results. Enter closes a phone's keyboard.

export interface HelpSearchEntry extends HelpEntry {
  category: string;
}

export function HelpSearch({ entries, children }: { entries: readonly HelpSearchEntry[]; children: ReactNode }) {
  // Plurals print numbers: French formatting on Tarifit pages (no Tarifit text here).
  const t = useNumbersTranslations("Help.search");
  const inputId = useId();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const field = useRef<HTMLInputElement>(null);
  // The address follows the field only once the person typed: the first render must not wipe the
  // #q= of a shared link before it is read.
  const typed = useRef(false);

  useEffect(() => {
    const fromHash = () => {
      const shared = queryFromHash(window.location.hash);
      if (shared) setQuery(shared);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    if (!typed.current) return;
    const hash = hashForQuery(deferred, window.location.hash);
    if (hash !== window.location.hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
  }, [deferred]);

  const change = (value: string) => {
    typed.current = true;
    setQuery(value);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    field.current?.blur();
  };
  const active = queryTokens(deferred).length > 0;
  const results = useMemo(() => (active ? matchHelp(entries, deferred, 8) : []), [active, entries, deferred]);

  return (
    <div className="flex flex-col gap-8">
      <form role="search" onSubmit={submit} className="relative">
        <label htmlFor={inputId} className="sr-only">
          {t("label")}
        </label>
        <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-foreground-muted" aria-hidden="true" />
        <input
          ref={field}
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => change(event.target.value)}
          maxLength={HELP_QUERY_MAX}
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t("placeholder")}
          className={cn(inputClassName, "h-13 rounded-lg ps-12 pe-12 text-base shadow-sm [&::-webkit-search-cancel-button]:hidden")}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              change("");
              field.current?.focus();
            }}
            aria-label={t("clear")}
            className="absolute end-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-foreground-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </form>

      <p aria-live="polite" className={active ? "text-sm text-foreground-muted" : "sr-only"}>
        {active ? (results.length > 0 ? t("results", { count: results.length }) : t("noResults", { query: deferred.trim() })) : ""}
      </p>

      {active ? (
        results.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {results.map((entry) => (
              <li key={entry.slug}>
                <Link href={`/aide/${entry.slug}`} className={cn("group flex flex-col gap-1 py-4", quietLinkClassName)}>
                  <span className="text-xs font-medium text-structure dark:text-gold-300">{entry.category}</span>
                  <span className="font-semibold group-hover:underline">{entry.title}</span>
                  <span className="text-sm text-pretty text-foreground-muted">{entry.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null
      ) : (
        children
      )}
    </div>
  );
}
