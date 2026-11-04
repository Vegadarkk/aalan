import "server-only";
import type { Locale } from "@/config/site";
import type { ExampleTitles } from "@/lib/examples/title";
import { DEMO_ENTRIES, type DemoEntry } from "./catalog";
import { demoListingId } from "./data";
import { DEMO_TRANSLATIONS, type DemoText } from "./translations";

// Example listings in the page language (owner, 2026-11-04: an Arabic example on a French page).
// Each catalog entry is written in one language (French, or Arabic for a few sellers);
// src/lib/demo/translations.ts holds the other one. Looked up by listing id at render time, so a
// change shows without a new seed: Firestore and the index keep the text the seed wrote. A
// member's listing is never translated. Tarifit pages show the French text (Latin script; no
// reviewed Tarifit text yet).

export type ExampleLanguage = "fr" | "ar";

const ARABIC_SCRIPT = /[؀-ۿ]/;

/** The language an entry is written in. */
export function entryLanguage(entry: Pick<DemoEntry, "title">): ExampleLanguage {
  return ARABIC_SCRIPT.test(entry.title) ? "ar" : "fr";
}

/** An entry's text in both languages; the original stands in for a missing translation. */
export function entryTexts(entry: DemoEntry): Record<ExampleLanguage, DemoText> {
  const original = { title: entry.title, description: entry.description };
  const translated = DEMO_TRANSLATIONS[entry.key];
  return entryLanguage(entry) === "ar" ? { fr: translated?.fr ?? original, ar: original } : { fr: original, ar: translated?.ar ?? original };
}

let byId: Map<string, Record<ExampleLanguage, DemoText>> | null = null;

function textsOf(id: string): Record<ExampleLanguage, DemoText> | undefined {
  byId ??= new Map(DEMO_ENTRIES.map((entry, index) => [demoListingId(index), entryTexts(entry)]));
  return byId.get(id);
}

function languageOf(locale: Locale): ExampleLanguage {
  return locale === "ar" ? "ar" : "fr";
}

/** An example listing's title per language (cards pick theirs: src/lib/examples/title.ts). */
export function exampleTitlesField(id: string, example: boolean): { titles?: ExampleTitles } {
  const texts = example ? textsOf(id) : undefined;
  return texts ? { titles: { fr: texts.fr.title, ar: texts.ar.title } } : {};
}

/** An example's titles in every language, indexed so a search in either language finds it. */
export function exampleSearchTitles(id: string): string[] {
  const texts = textsOf(id);
  return texts ? [texts.fr.title, texts.ar.title] : [];
}

/** The listing page of an example in `locale`; any other listing unchanged. */
export function localizeExample<T extends { id: string; example: boolean; title: string; description: string }>(listing: T, locale: Locale): T {
  const texts = listing.example ? textsOf(listing.id) : undefined;
  return texts ? { ...listing, ...texts[languageOf(locale)] } : listing;
}
