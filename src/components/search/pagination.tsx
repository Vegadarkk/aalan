import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { SEARCH_MAX_PAGE, SEARCH_PAGE_SIZE, type SearchParams } from "@/lib/search/params";
import { cn } from "@/lib/utils";
import { paginationItems, withPage } from "./filter-model";
import { SearchLink } from "./search-navigation";

// Pages of results (§6: 50 pages of 24 at most). Links, so every page has its own URL. Phones get
// "previous · page n of m · next"; larger screens the numbers. Arrows follow the reading direction.
// The map panel (`compact`) keeps numbers at every width, sized to the panel (a container query):
// the first, the current and the last page in a narrow one (phone sheet, tablet panel), the current
// page's neighbours too from 23.5rem (desktop panel); audit zone 2 P3-3.

const item = cn(
  "inline-flex size-11 items-center justify-center rounded-md text-sm font-medium tabular-nums",
  "transition-[background-color,color,scale] duration-150 ease-door hover:bg-surface-muted",
);
// Press feedback on the links only: the current page and a disabled arrow are plain spans.
const link = cn(item, "active:scale-[0.98]");

interface PaginationProps {
  params: SearchParams;
  page: number;
  totalPages: number;
  /** Total hits: past SEARCH_MAX_PAGE pages, a note asks to narrow the search. */
  total?: number;
  pageSize?: number;
  /** The map panel: numbers fitted to the panel's width, never the "page n of m" line. */
  compact?: boolean;
  className?: string;
}

export function Pagination({ params, page, totalPages, total, pageSize = SEARCH_PAGE_SIZE, compact = false, className }: PaginationProps) {
  const t = useTranslations("SearchPage.pagination");
  const last = Math.min(totalPages, SEARCH_MAX_PAGE);
  if (last <= 1) return null;
  const current = Math.min(Math.max(page, 1), last);
  const capped = total !== undefined && total > SEARCH_MAX_PAGE * pageSize;

  // `around`: pages shown each side of the current one; `hidden`: where this set is not shown.
  const numbers = (around: number, hidden: string) =>
    paginationItems(current, last, around).map((entry, index) =>
      entry === "gap" ? (
        <li key={`${around}-gap-${index}`} aria-hidden="true" className={cn("text-center text-foreground-muted", compact ? "w-5" : "w-6", hidden)}>
          …
        </li>
      ) : (
        <li key={`${around}-${entry}`} className={hidden}>
          {entry === current ? (
            <span aria-current="page" className={cn(item, "bg-structure text-structure-foreground hover:bg-structure")}>
              {entry}
            </span>
          ) : (
            <SearchLink params={withPage(params, entry)} aria-label={t("page", { page: entry })} className={link}>
              {entry}
            </SearchLink>
          )}
        </li>
      ),
    );

  return (
    <nav aria-label={t("label")} className={cn("flex flex-col items-center gap-3", compact && "@container", className)}>
      <ul className={cn("flex items-center", compact ? "gap-0.5" : "gap-1")}>
        <li>
          {current > 1 ? (
            <SearchLink params={withPage(params, current - 1)} rel="prev" aria-label={t("previous")} className={link}>
              <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden="true" />
            </SearchLink>
          ) : (
            <span aria-hidden="true" className={cn(item, "opacity-35")}>
              <ChevronLeft className="size-5 rtl:-scale-x-100" />
            </span>
          )}
        </li>
        {compact ? (
          <>
            {/* 9 items of 44 px at most with one neighbour each side (1 2 3 4 5 … 50), 7 without. */}
            {numbers(0, "@min-[24.25rem]:hidden")}
            {numbers(1, "@max-[24.25rem]:hidden")}
          </>
        ) : (
          <>
            <li className="px-3 text-sm text-foreground-muted tabular-nums sm:hidden">{t("status", { page: current, total: last })}</li>
            {numbers(2, "max-sm:hidden")}
          </>
        )}
        <li>
          {current < last ? (
            <SearchLink params={withPage(params, current + 1)} rel="next" aria-label={t("next")} className={link}>
              <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden="true" />
            </SearchLink>
          ) : (
            <span aria-hidden="true" className={cn(item, "opacity-35")}>
              <ChevronRight className="size-5 rtl:-scale-x-100" />
            </span>
          )}
        </li>
      </ul>
      {capped && current === last ? <p className="max-w-md text-center text-sm text-foreground-muted text-pretty">{t("capped", { pages: SEARCH_MAX_PAGE })}</p> : null}
    </nav>
  );
}
