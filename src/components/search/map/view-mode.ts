// Map or list (Carte vivante, lot 2): pure rules, read by the client root.
// The home page opens on the list; a search opens on the map (owner, 2026-11-02) on a computer, on
// the list on a phone or a tablet below lg (owner, 2026-11-03, audit zone 8 P0, B14: MapLibre ran
// 4.5 s on a mid-range Android before the page answered), when the runtime config has a basemap and
// the browser can draw it (WebGL2). The server renders the list: a phone never swaps layouts. A visitor who saves data or sits on a
// 2G link stays on the list (the map costs ~430 KB of script plus tiles). A choice made with the
// toggle holds for those results only (later pages, back from a listing): the next search opens on
// the map again. It lives in the tab (sessionStorage), never across visits.

import { canonicalSearchParams, searchParamsToQuery, type SearchParams } from "@/lib/search/params";

/** The desktop breakpoint (lg): the map opens by itself, the detail panel beside it. Shared with the client root. */
export const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * The map's list as a side panel from md, a narrower one on a tablet (globals.css, `--search-panel-w`);
 * a bottom sheet below (audit zone 2 P3-9). The view a tablet opens in still follows DESKTOP_QUERY.
 */
export const SIDE_PANEL_QUERY = "(min-width: 48rem)";

export type SearchView = "map" | "list";

/** Which page the toggle serves: the search results, or the home page's recent listings. */
export type SearchMapVariant = "search" | "home";

export const VIEW_STORAGE_KEY = "search-view";

export interface ViewContext {
  variant: SearchMapVariant;
  /** publicConfig.map is set (a PMTiles archive is configured). */
  hasMap: boolean;
  webgl2: boolean;
  /** navigator.connection.saveData */
  saveData?: boolean;
  /** navigator.connection.effectiveType ("slow-2g", "2g", "3g", "4g"). */
  effectiveType?: string;
  /** The visitor's choice for these very results, if any. */
  stored?: string | null;
  /** Below the desktop breakpoint (DESKTOP_QUERY): the map waits for a tap on « Carte ». */
  phone?: boolean;
}

/** Whether the map can be shown at all. */
export function mapPossible(context: Pick<ViewContext, "hasMap" | "webgl2">): boolean {
  return context.hasMap && context.webgl2;
}

export function slowConnection(context: Pick<ViewContext, "saveData" | "effectiveType">): boolean {
  return context.saveData === true || context.effectiveType === "2g" || context.effectiveType === "slow-2g";
}

/**
 * The view a page starts in before the browser is known (server render, hydration): the list, which
 * a phone keeps (B14); a computer turns to the map once hydrated.
 */
export function defaultView(_variant: SearchMapVariant, _hasMap: boolean): SearchView {
  return "list";
}

/** The view the page starts in once hydrated. */
export function initialView(context: ViewContext): SearchView {
  if (!mapPossible(context)) return "list";
  if (context.stored === "map" || context.stored === "list") return context.stored;
  if (context.variant === "home" || context.phone) return "list";
  return slowConnection(context) ? "list" : "map";
}

/**
 * The results a toggle choice belongs to: the search itself, not its page or order, nor the
 * sold-out switch (changing those shows the same search). Any other change is a new search.
 */
export function viewKey(variant: SearchMapVariant, params: SearchParams): string {
  if (variant === "home") return "home";
  const { page: _page, sort: _sort, includeSoldOut: _soldOut, raw: _raw, ...search } = canonicalSearchParams(params);
  return `search?${searchParamsToQuery(search).toString()}`;
}

interface StoredView {
  key: string;
  view: SearchView;
}

function readStored(): StoredView | null {
  try {
    const raw = window.sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { key, view } = parsed as Record<string, unknown>;
    return typeof key === "string" && (view === "map" || view === "list") ? { key, view } : null;
  } catch {
    return null;
  }
}

/** The choice stored for these results (null: none, or it was made for other results). */
export function storedView(key: string): SearchView | null {
  const stored = readStored();
  return stored && stored.key === key ? stored.view : null;
}

/** The browser's side of the context (client only; every read is guarded). */
export function browserViewContext(variant: SearchMapVariant, key: string, hasMap: boolean, webgl2: boolean): ViewContext {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return { variant, hasMap, webgl2, saveData: connection?.saveData, effectiveType: connection?.effectiveType, stored: storedView(key), phone: !window.matchMedia(DESKTOP_QUERY).matches };
}

export function rememberView(key: string, view: SearchView): void {
  try {
    window.sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ key, view } satisfies StoredView));
  } catch {
    // Private window or blocked storage: the choice lasts for this page only.
  }
  try {
    // Before 2026-11-02 the choice was kept on the device, for every page: no longer read.
    window.localStorage.removeItem(VIEW_STORAGE_KEY);
  } catch {
    // Blocked storage: nothing was kept there either.
  }
}
