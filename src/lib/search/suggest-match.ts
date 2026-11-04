import { tokenize } from "@/lib/text/normalize";

// Matching side of the search suggestions (audit §7), in the header's bundle: the index comes from
// /api/search/suggestions/{locale} (built by suggestions.ts from the categories and the
// interpreter's vocabulary), the typed words are matched here at every key, and the last searches
// stay on this device. Client-safe and pure.

export type SuggestionKind = "category" | "subcategory" | "thing" | "brand" | "model";

export interface Suggestion {
  /** Shown in the list (in the page's locale). */
  label: string;
  /** The category it belongs to, shown under the label. */
  context?: string;
  kind: SuggestionKind;
  /** Normalized phrases that lead to it (words joined by one space). */
  keys: string[];
  /**
   * The search it opens: URL query of its filters (categories, nouns; the place is added), or words
   * searched as typed (brands, models: the interpreter turns them into filters).
   */
  target: { query: Record<string, string> } | { q: string };
}

export interface SuggestionLabels {
  category: (id: string) => string;
  subcategory: (categoryId: string, id: string) => string;
  option: (criterionId: string, optionId: string) => string;
}

const norm = (text: string) => tokenize(text).join(" ");

/** Where the typed words sit in a key: 0 the whole key, 1 its start, 2 a later word; null no match. */
function keyScore(key: readonly string[], typed: readonly string[]): number | null {
  const last = typed.length - 1;
  for (let start = 0; start + typed.length <= key.length; start += 1) {
    let fits = true;
    for (let index = 0; index < last && fits; index += 1) fits = key[start + index] === typed[index];
    if (!fits || !(key[start + last] ?? "").startsWith(typed[last] ?? "")) continue;
    if (start > 0) return 2;
    return key.length === typed.length && key[last] === typed[last] ? 0 : 1;
  }
  return null;
}

const KIND_ORDER: Record<SuggestionKind, number> = { subcategory: 0, thing: 1, category: 2, brand: 3, model: 4 };

/** Fewest letters before suggestions show. */
export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_LIMIT = 7;

/** The suggestions for typed words, best first. */
export function matchSuggestions(index: readonly Suggestion[], typed: string, limit = SUGGEST_LIMIT): Suggestion[] {
  const words = tokenize(typed);
  if (words.join("").length < SUGGEST_MIN_CHARS) return [];
  const scored: { suggestion: Suggestion; score: number }[] = [];
  for (const suggestion of index) {
    let best: number | null = null;
    for (const key of suggestion.keys) {
      const score = keyScore(key.split(" "), words);
      if (score !== null && (best === null || score < best)) best = score;
      if (best === 0) break;
    }
    if (best !== null) scored.push({ suggestion, score: best });
  }
  scored.sort((a, b) => a.score - b.score || KIND_ORDER[a.suggestion.kind] - KIND_ORDER[b.suggestion.kind] || a.suggestion.label.length - b.suggestion.label.length || a.suggestion.label.localeCompare(b.suggestion.label));
  return scored.slice(0, limit).map((each) => each.suggestion);
}

// ---- Recent searches (this device only) -------------------------------------------------------

export const RECENT_SEARCHES_KEY = "recent-searches";
export const RECENT_SEARCHES_MAX = 5;

/** The list after searching `q`: newest first, no duplicates (case and accents folded), capped. */
export function withRecentSearch(list: readonly string[], q: string): string[] {
  const text = q.replace(/\s+/g, " ").trim();
  if (!text) return [...list];
  const folded = norm(text);
  return [text, ...list.filter((each) => norm(each) !== folded)].slice(0, RECENT_SEARCHES_MAX);
}

export function readRecentSearches(storage: Pick<Storage, "getItem"> | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENT_SEARCHES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((each): each is string => typeof each === "string").slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}
