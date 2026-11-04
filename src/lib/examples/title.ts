import type { Locale } from "@/config/site";

// The title a card shows in the page language. An example listing (src/lib/demo) carries its title
// in French and Arabic (src/lib/demo/localized.ts); a member's listing stays in the language its
// author wrote it in, like on Leboncoin. Client-safe: no catalog import.

/** An example listing's title per language; Tarifit pages show the French one. */
export type ExampleTitles = Readonly<Partial<Record<Locale, string>>>;

export function shownTitle(card: { title: string; titles?: ExampleTitles }, locale: Locale): string {
  return card.titles?.[locale] ?? card.titles?.fr ?? card.title;
}
