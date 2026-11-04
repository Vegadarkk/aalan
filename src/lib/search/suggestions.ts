import { CAR_MODELS } from "@/config/car-models";
import { CATEGORIES, subcategoryById } from "@/config/categories";
import { tokenize } from "@/lib/text/normalize";
import type { Suggestion, SuggestionLabels } from "./suggest-match";
import { lexiconPhrases } from "./interpret/lexicon";
import { canonicalSearchParams, searchQueryObject, type CriterionFilter, type SearchParams } from "./params";

// Search suggestions while typing (audit §7). The vocabulary the search already understands
// (categories, subcategories, the interpreter's nouns in French, Arabic and Darija, vehicle brands
// and car models) becomes one small index per locale, served once by
// /api/search/suggestions/{locale} (static, cached) and matched in the browser at every key: no
// request per keystroke, no engine call, nothing typed leaves the device before the search itself.
// This file builds the index (server route); suggest-match.ts matches it in the browser.

const norm = (text: string) => tokenize(text).join(" ");

const filters = (params: SearchParams): Suggestion["target"] => ({ query: searchQueryObject(canonicalSearchParams(params)) });

function targetKey(target: Suggestion["target"]): string {
  return "q" in target ? `q:${target.q.toLowerCase()}` : `p:${new URLSearchParams(target.query).toString()}`;
}

/** The index of a locale. `fallback` (French) adds its names as keys, so a French word finds an Arabic label. */
export function buildSuggestions(labels: SuggestionLabels, fallback?: SuggestionLabels): Suggestion[] {
  const byTarget = new Map<string, Suggestion>();
  const add = (entry: Omit<Suggestion, "keys">, keys: readonly string[]) => {
    const key = targetKey(entry.target);
    const clean = keys.map(norm).filter(Boolean);
    const known = byTarget.get(key);
    if (known) {
      for (const each of clean) if (!known.keys.includes(each)) known.keys.push(each);
      return;
    }
    byTarget.set(key, { ...entry, keys: [...new Set(clean)] });
  };

  for (const category of CATEGORIES) {
    const label = labels.category(category.id);
    add({ label, kind: "category", target: filters({ category: category.id }) }, [label, ...(fallback ? [fallback.category(category.id)] : [])]);
    for (const sub of category.subcategories) {
      const subLabel = labels.subcategory(category.id, sub.id);
      add({ label: subLabel, context: label, kind: "subcategory", target: filters({ subcategory: sub.id }) }, [subLabel, ...(fallback ? [fallback.subcategory(category.id, sub.id)] : [])]);
    }
  }

  for (const { entry, phrase } of lexiconPhrases()) {
    if (entry.kind === "thing") {
      if (entry.weak) continue;
      const sub = entry.subcategory ? subcategoryById(entry.subcategory) : undefined;
      const categoryId = sub?.categoryId ?? entry.category;
      if (!categoryId) continue;
      const criteria = entry.criteria ? Object.entries(entry.criteria) : [];
      const params: SearchParams = sub ? { subcategory: sub.id } : { category: categoryId };
      if (criteria.length > 0) params.criteria = Object.fromEntries(criteria.map(([id, value]): [string, CriterionFilter] => [id, { kind: "options", values: [value] }]));
      const [first] = criteria;
      // A noun with a criterion reads as its option ("Réfrigérateur"), else as its subcategory.
      const label = first ? labels.option(first[0], first[1]) : sub ? labels.subcategory(categoryId, sub.id) : labels.category(categoryId);
      const context = sub && first ? labels.subcategory(categoryId, sub.id) : first || sub ? labels.category(categoryId) : undefined;
      add({ label, ...(context ? { context } : {}), kind: first ? "thing" : sub ? "subcategory" : "category", target: filters(params) }, [phrase, label]);
    } else if (entry.kind === "brand") {
      const criterion = entry.car ? "car-brand" : "moto-brand";
      const id = entry.car ?? entry.moto;
      if (!id) continue;
      const label = labels.option(criterion, id);
      add({ label, context: labels.subcategory("vehicules", entry.car ? "voitures" : "motos-scooters"), kind: "brand", target: { q: label } }, [phrase, label]);
    } else if (entry.kind === "model") {
      const model = CAR_MODELS.find((each) => each.id === entry.model);
      if (!model) continue;
      const label = `${labels.option("car-brand", model.brand)} ${model.label}`;
      add({ label, context: labels.subcategory("vehicules", "voitures"), kind: "model", target: { q: label } }, [phrase, label, model.label]);
    }
  }
  return [...byTarget.values()];
}
