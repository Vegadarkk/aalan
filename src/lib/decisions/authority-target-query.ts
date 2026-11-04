import { isListingId, LISTING_ID_LENGTH, parseSlugId } from "@/lib/listings/ids";
import { parseTargetKey, splitMessageId } from "@/lib/reports/target-key";
import { accountLookups, type AccountLookup } from "./account-query";
import { AUTHORITY_SCOPE_PATTERN } from "./contracts";

// What an admin pasted or typed in the content picker of the authority form (audit zone 7 P3-4),
// read as the lookups to run: a scope entry as stored (`listing:{id}`, `user:{uid}`,
// `conversation:{cid}`), a public link (listing, profile), a back-office link (account,
// conversation, report target, listing review), or words: account lookups (e-mail, phone, name,
// ids) and a listing title search. Pure and client-safe.

export const AUTHORITY_TARGET_QUERY_MAX = 300;
/** Shortest text sent to the listing title search. */
export const TITLE_QUERY_MIN = 3;

export interface AuthorityTargetLookups {
  listings: string[];
  conversations: string[];
  accounts: AccountLookup[];
  /** Words for the listing title search (published listings), or null. */
  title: string | null;
}

const CID = /^[A-Za-z0-9_-]{22}$/;
const NONE: AuthorityTargetLookups = { listings: [], conversations: [], accounts: [], title: null };

function only(part: Partial<AuthorityTargetLookups>): AuthorityTargetLookups {
  return { ...NONE, ...part };
}

function segmentAfter(input: string, name: string): string | null {
  const match = new RegExp(`/${name}/([^/?#\\s]+)`).exec(input);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** The `cle` parameter of a report target link (`/signalements/cible?cle=listing:…`), decoded. */
function targetKeyParam(input: string): string | null {
  const match = /[?&]cle=([^&#\s]+)/.exec(input);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** A stored scope entry (or a report target key) as a lookup; null when it is neither. */
function fromEntry(entry: string): AuthorityTargetLookups | null {
  if (AUTHORITY_SCOPE_PATTERN.test(entry)) {
    const separator = entry.indexOf(":");
    const kind = entry.slice(0, separator);
    const id = entry.slice(separator + 1);
    if (kind === "listing") return only({ listings: [id] });
    if (kind === "conversation") return only({ conversations: [id] });
    return only({ accounts: [{ kind: "uid", uid: id }] });
  }
  const target = parseTargetKey(entry);
  if (target?.type === "listing") return only({ listings: [target.id] });
  if (target?.type === "user") return only({ accounts: [{ kind: "uid", uid: target.id }] });
  if (target?.type === "message") {
    const ids = splitMessageId(target.id);
    return ids ? only({ conversations: [ids.cid] }) : NONE;
  }
  return null;
}

/** The lookups for a picker query; every list empty and `title` null when there is nothing to look up. */
export function authorityTargetLookups(raw: string): AuthorityTargetLookups {
  const query = raw.trim().slice(0, AUTHORITY_TARGET_QUERY_MAX);
  if (query.length < 2) return NONE;

  const direct = fromEntry(query);
  if (direct) return direct;
  const key = targetKeyParam(query);
  if (key) return fromEntry(key) ?? NONE;

  const conversation = segmentAfter(query, "conversations");
  if (conversation) return CID.test(conversation) ? only({ conversations: [conversation] }) : NONE;
  const review = segmentAfter(query, "moderation");
  if (review) return isListingId(review.toLowerCase()) ? only({ listings: [review.toLowerCase()] }) : NONE;
  const listing = segmentAfter(query, "annonce");
  if (listing) {
    const parsed = parseSlugId(listing.toLowerCase());
    return parsed ? only({ listings: [parsed.id] }) : NONE;
  }
  // Profile and account links, e-mails, phones, ids and names: the account search's own reading,
  // without its "listing link -> author" lookup (here a listing is the content itself).
  const accounts = accountLookups(query).filter((lookup) => lookup.kind !== "listing");
  if (segmentAfter(query, "profil") || segmentAfter(query, "comptes") || query.includes("@") || /^\+?[\d\s().-]+$/.test(query)) return only({ accounts });

  const lower = query.toLowerCase();
  const listings = lower.length === LISTING_ID_LENGTH && isListingId(lower) ? [lower] : [];
  const title = query.length >= TITLE_QUERY_MIN && !/^[a-z]+:/i.test(query) && !/^https?:\/\//i.test(query) ? query : null;
  return { listings, conversations: CID.test(query) ? [query] : [], accounts, title };
}

/** True when the lookups find nothing to run (the picker explains what it accepts). */
export function isEmptyLookup(lookups: AuthorityTargetLookups): boolean {
  return lookups.listings.length === 0 && lookups.conversations.length === 0 && lookups.accounts.length === 0 && lookups.title === null;
}
