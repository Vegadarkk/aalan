import { isDeepStrictEqual } from "node:util";
import type { ListingStatus } from "@/lib/contracts/listings";
import type { ListingFieldPatch } from "@/lib/db/repositories/listings";
import type { ListingDoc } from "@/lib/db/schemas";

// What an owner's save may change on a listing once it is screened or under review (pure, no I/O):
// the fields the pre-moderation reads, the content freeze of a listing under review (audit C-2) and
// the statuses the moderation agent screens again after an edit (audit C-1).

/** Fields whose change re-runs the pre-moderation (every free text, the district included). */
export const SCREENED_FIELDS: readonly (keyof ListingDoc)[] = ["title", "description", "attributes", "categoryId", "subcategoryId", "price", "isDonation", "photos", "contact", "location"];

/**
 * What the pre-moderation reads of the variants: the axes (free labels and values are texts) and
 * the prices; the stock alone is never screened again (catalogue §3).
 */
export function screenedVariants(variants: ListingDoc["variants"] | null | undefined): unknown {
  return variants ? { axes: variants.axes, items: variants.items.map(({ stock: _stock, ...item }) => item) } : null;
}

/** A save (changed fields only) that changes what the screens read: texts, criteria, prices, photos, contact, place, combinations. */
export function changesScreenedContent(listing: Pick<ListingDoc, "variants">, fields: ListingFieldPatch): boolean {
  if (SCREENED_FIELDS.some((field) => fields[field] !== undefined)) return true;
  return fields.variants !== undefined && !isDeepStrictEqual(screenedVariants(fields.variants), screenedVariants(listing.variants));
}

/**
 * Under review (audit C-2): a legal hold (`report:`, `authority:`, `appeal:`) or an open report.
 * Its content stays as reported until the decision lifts the hold, so the moderator, the agent's
 * triage and an authority see what was reported (reviews do the same, src/lib/reviews/repository.ts).
 */
export function contentFrozen(listing: Pick<ListingDoc, "legalHold" | "moderation">): boolean {
  return listing.legalHold.length > 0 || listing.moderation.openReports > 0;
}

/**
 * Statuses in which the moderation agent acts on a screening (src/lib/ai/apply.ts): a held listing
 * may be approved or rejected alone, a published one gets a system report. A screened edit that
 * ends in one of them is screened by the agent too (audit C-1), not only by the rules.
 */
export const AGENT_SCREENED_STATUSES: readonly ListingStatus[] = ["published", "pending_review"];
