import { categoryById, criterionById, subcategoryById } from "@/config/categories";

// Key facts of a result card (Agence pack design §2): the category's `cardFacts` (number criteria
// such as the surface and the rooms, select criteria such as a car's fuel: audit lot 7, zone 2
// P1-3) and the exclusive mandate of a real-estate agency. Built from
// a listing's attributes (Firestore cards) or from the index's `a_*` fields (search cards), so
// both card sources show the same line. A zero (a studio's bedrooms) says nothing on a card. Client-safe.

export interface CardFact {
  id: string;
  /** A number criterion's value, or a select criterion's option id. */
  value: number | string;
}

export interface CardFacts {
  facts: CardFact[];
  /** Exclusive mandate (`mandate = exclusif`): "Exclusivité" on the card. */
  exclusive: boolean;
}

export const NO_CARD_FACTS: CardFacts = { facts: [], exclusive: false };

/** `read(criterionId)` returns the listing's value for that criterion, whatever its source. */
export function cardFactsOf(subcategoryId: string | null | undefined, read: (criterionId: string) => unknown): CardFacts {
  const subcategory = subcategoryId ? subcategoryById(subcategoryId) : undefined;
  if (!subcategory) return NO_CARD_FACTS;
  const declared = new Set(subcategory.criteria.map((criterion) => criterion.id));
  const facts: CardFact[] = [];
  for (const id of categoryById(subcategory.categoryId)?.cardFacts ?? []) {
    const value = read(id);
    if (!declared.has(id)) continue;
    const criterion = criterionById(id);
    if (criterion?.type === "number" && typeof value === "number" && Number.isFinite(value) && value > 0) facts.push({ id, value });
    // "autre" says nothing on a card.
    else if (criterion?.type === "select" && typeof value === "string" && value !== "autre" && criterion.options?.includes(value)) facts.push({ id, value });
  }
  return { facts, exclusive: declared.has("mandate") && read("mandate") === "exclusif" };
}

/** `{ facts }` to spread into a card, or nothing when there is none to show. */
export function cardFactsField(facts: CardFacts): { facts?: CardFacts } {
  return facts.facts.length > 0 || facts.exclusive ? { facts } : {};
}

/** Message key of a card fact under `ListingCard`: a number's own (`facts.mileage`), a select option's (`facts.fuel.diesel`). */
export function factKey(fact: CardFact): string {
  return typeof fact.value === "string" ? `facts.${fact.id}.${fact.value}` : `facts.${fact.id}`;
}
