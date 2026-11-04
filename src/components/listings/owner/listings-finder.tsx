"use client";

import { useId } from "react";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/post/controls/select";
import { inputClassName } from "@/components/ui/input";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import type { OwnerListingSummary } from "@/lib/contracts/listings";
import { includesNormalized } from "@/lib/text/normalize";
import { cn } from "@/lib/utils";

// Search and category filter of « Mes annonces » (audit §7: a dealer with dozens of cars finds one
// at once). Over the rows of the tab, already loaded: words of the title or the city (case, accents
// and Arabic variants folded), and the category when the tab holds several. Shown from a handful
// of rows, or while a search is on.

export interface FindState {
  q: string;
  categoryId: string | null;
}

export const NO_FIND: FindState = { q: "", categoryId: null };

/** Rows from which the search shows (a short list needs none). */
export const FINDER_MIN_ROWS = 6;

const finding = (state: FindState) => state.q.trim() !== "" || state.categoryId !== null;

export function finderShown(rows: readonly OwnerListingSummary[], state: FindState): boolean {
  return rows.length >= FINDER_MIN_ROWS || finding(state);
}

/** The categories of the rows, in order of first appearance. */
export function rowCategories(rows: readonly OwnerListingSummary[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.categoryId ? [row.categoryId] : [])))];
}

/** The rows the search keeps: every word in the title or the city name, and the chosen category. */
export function findListings(rows: readonly OwnerListingSummary[], state: FindState, locale: Locale): OwnerListingSummary[] {
  if (!finding(state)) return [...rows];
  const words = state.q.split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (state.categoryId && row.categoryId !== state.categoryId) return false;
    if (words.length === 0) return true;
    const city = row.citySlug ? cityBySlug(row.citySlug) : undefined;
    const text = `${row.title} ${city ? `${cityName(city, "fr")} ${cityName(city, locale)}` : ""}`;
    return words.every((word) => includesNormalized(text, word));
  });
}

interface ListingsFinderProps {
  rows: readonly OwnerListingSummary[];
  value: FindState;
  onChange: (value: FindState) => void;
  /** Rows kept by the search. */
  shown: number;
  className?: string;
}

export function ListingsFinder({ rows, value, onChange, shown, className }: ListingsFinderProps) {
  const t = useTranslations("MyListings.find");
  const categories = useTranslations("Categories");
  const id = useId();
  const options = rowCategories(rows);
  return (
    <div role="search" aria-label={t("label")} data-testid="listings-finder" className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${id}-q`} className="sr-only">
            {t("label")}
          </label>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" aria-hidden="true" />
          <input
            id={`${id}-q`}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={80}
            value={value.q}
            onChange={(event) => onChange({ ...value, q: event.target.value })}
            placeholder={t("placeholder")}
            className={cn(inputClassName, "h-11 ps-9 pe-11 [&::-webkit-search-cancel-button]:hidden")}
          />
          {value.q ? (
            <button
              type="button"
              aria-label={t("clear")}
              onClick={() => onChange({ ...value, q: "" })}
              className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-md text-foreground-muted transition-colors duration-150 ease-door hover:text-foreground focus-visible:-outline-offset-2"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {options.length > 1 ? (
          <div className="sm:w-56">
            <label htmlFor={`${id}-category`} className="sr-only">
              {t("category")}
            </label>
            <Select id={`${id}-category`} value={value.categoryId ?? ""} onChange={(event) => onChange({ ...value, categoryId: event.target.value || null })} className="h-11 w-full truncate">
              <option value="">{t("allCategories")}</option>
              {options.map((category) => (
                <option key={category} value={category}>
                  {categories.has(`${category}.name` as never) ? categories(`${category}.name` as never) : category}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-foreground-muted">
        {finding(value) ? t("count", { shown, total: rows.length }) : null}
      </p>
    </div>
  );
}
