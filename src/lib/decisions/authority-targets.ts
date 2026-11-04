import "server-only";
import { cityBySlug, cityName } from "@/config/regions";
import { getListing, type ListingRecord } from "@/lib/db/repositories/listings";
import { getUserRecord } from "@/lib/db/repositories/profiles";
import { logger } from "@/lib/logging/logger";
import { getConversation } from "@/lib/messaging/repository";
import { searchEngine } from "@/lib/search/engine";
import { normalizeQuery } from "@/lib/search/normalize";
import { searchAccountLookups, type Searcher } from "./account-search";
import { authorityTargetLookups, isEmptyLookup } from "./authority-target-query";
import type { AuthorityTargetCandidate, AuthorityTargetsResponse } from "./contracts";

// Content picker of the authority form (audit zone 7 P3-4): what a pasted link, an id, an
// e-mail, a phone, a name or a listing title designates, previewed before the request is
// recorded. Bounded reads: exact keys, the account search's prefix ranges, and at most
// TITLE_HITS_MAX listings from the search index (published listings only).

export const TITLE_HITS_MAX = 5;
export const CANDIDATES_MAX = 15;

async function listingCandidate(listing: ListingRecord): Promise<AuthorityTargetCandidate> {
  const owner = await getUserRecord(listing.ownerUid);
  const city = listing.location?.citySlug ? cityBySlug(listing.location.citySlug) : undefined;
  return {
    kind: "listing",
    entry: `listing:${listing.id}`,
    title: listing.title,
    status: listing.status,
    price: listing.price ?? null,
    isDonation: listing.isDonation,
    ownerName: owner?.displayName ?? null,
    city: city ? cityName(city, "fr") : null,
  };
}

async function listingsByTitle(text: string): Promise<string[]> {
  const q = normalizeQuery(text);
  if (!q) return [];
  try {
    const [result] = await searchEngine().search([{ q, page: 1, hitsPerPage: TITLE_HITS_MAX, matchingStrategy: "all", fields: ["id"] }]);
    return (result?.hits ?? []).map((hit) => hit.id);
  } catch (error) {
    // The title search is a convenience: links and ids still resolve without the engine.
    logger.warn({ err: (error as Error).message }, "authority targets: title search unavailable");
    return [];
  }
}

export async function resolveAuthorityTargets(searcher: Searcher, raw: string, options: { ip?: string; now?: Date } = {}): Promise<AuthorityTargetsResponse> {
  const lookups = authorityTargetLookups(raw);
  if (isEmptyLookup(lookups)) return { candidates: [], unreadable: true };

  const [titled, accounts, conversations] = await Promise.all([
    lookups.title ? listingsByTitle(lookups.title) : Promise.resolve([]),
    lookups.accounts.length > 0 ? searchAccountLookups(searcher, lookups.accounts, options) : Promise.resolve([]),
    Promise.all(lookups.conversations.map(getConversation)),
  ]);
  const listingIds = [...new Set([...lookups.listings, ...titled])];
  const listings = (await Promise.all(listingIds.map(getListing))).filter((listing): listing is ListingRecord => listing !== null && listing.status !== "purged");

  const candidates: AuthorityTargetCandidate[] = [];
  for (const listing of listings) candidates.push(await listingCandidate(listing));
  for (const conversation of conversations) {
    if (!conversation) continue;
    candidates.push({
      kind: "conversation",
      entry: `conversation:${conversation.cid}`,
      listingTitle: conversation.listingSnapshot.title,
      buyerName: conversation.buyerName,
      sellerName: conversation.sellerName,
      frozen: conversation.status === "frozen",
      messageCount: conversation.messageCount,
    });
  }
  for (const hit of accounts) {
    candidates.push({ kind: "user", entry: `user:${hit.uid}`, displayName: hit.displayName, status: hit.status, accountType: hit.type, publicId: hit.publicId, activeListings: hit.activeListings });
  }
  return { candidates: candidates.slice(0, CANDIDATES_MAX), unreadable: false };
}
