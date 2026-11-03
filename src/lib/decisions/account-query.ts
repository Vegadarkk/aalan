import { LISTING_ID_LENGTH, isListingId, parseSlugId } from "@/lib/listings/ids";

// What a moderator typed in the back-office account search (B12, audit zone 7 P1-1), read as the
// lookups to run: an e-mail, a verified phone, a profile or listing link or id, an account uid, or
// a display name. An ambiguous word (8 or 10 letters) runs both its id lookup and the name lookup.
// Pure and client-safe.

export type AccountLookup =
  | { kind: "email"; email: string }
  | { kind: "phone"; e164: string }
  | { kind: "profile"; publicId: string }
  | { kind: "listing"; listingId: string }
  | { kind: "uid"; uid: string }
  | { kind: "name"; prefix: string };

export const ACCOUNT_QUERY_MAX = 200;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PUBLIC_ID = /^[a-hj-km-np-z2-9]{10}$/;
const UID = /^[A-Za-z0-9_-]{20,128}$/;
const PHONE_INPUT = /^\+?[\d\s().-]{9,20}$/;

/** A typed Moroccan number (06…, 07…, 05…, +212…, 00212…) in E.164, or null. */
export function phoneE164(input: string): string | null {
  if (!PHONE_INPUT.test(input)) return null;
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (/^0[5-7]\d{8}$/.test(digits)) digits = `+212${digits.slice(1)}`;
  if (/^212[5-7]\d{8}$/.test(digits)) digits = `+${digits}`;
  return /^\+212[5-7]\d{8}$/.test(digits) ? digits : null;
}

/** The last path segment after `/{name}/` in a pasted URL or path, or null. */
function segmentAfter(input: string, name: string): string | null {
  const match = new RegExp(`/${name}/([^/?#\\s]+)`).exec(input);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** The lookups for a query, most specific first; empty when there is nothing to look up. */
export function accountLookups(raw: string): AccountLookup[] {
  const query = raw.trim().slice(0, ACCOUNT_QUERY_MAX);
  if (query.length < 2) return [];
  const profile = segmentAfter(query, "profil");
  if (profile) return PUBLIC_ID.test(profile.toLowerCase()) ? [{ kind: "profile", publicId: profile.toLowerCase() }] : [];
  const listing = segmentAfter(query, "annonce");
  if (listing) {
    const parsed = parseSlugId(listing.toLowerCase());
    return parsed ? [{ kind: "listing", listingId: parsed.id }] : [];
  }
  const accountPage = segmentAfter(query, "comptes");
  if (accountPage) return UID.test(accountPage) ? [{ kind: "uid", uid: accountPage }] : [];
  if (query.includes("@")) return EMAIL.test(query) ? [{ kind: "email", email: query.toLowerCase() }] : [];
  const phone = phoneE164(query);
  if (phone) return [{ kind: "phone", e164: phone }];
  if (/^\+?[\d\s().-]+$/.test(query)) return [];
  const lookups: AccountLookup[] = [];
  const lower = query.toLowerCase();
  if (PUBLIC_ID.test(lower)) lookups.push({ kind: "profile", publicId: lower });
  if (lower.length === LISTING_ID_LENGTH && isListingId(lower)) lookups.push({ kind: "listing", listingId: lower });
  if (UID.test(query)) lookups.push({ kind: "uid", uid: query });
  if (query.length <= 40) lookups.push({ kind: "name", prefix: query });
  return lookups;
}

/** The spellings tried for a name prefix (Firestore compares case-sensitively): as typed, first letter up, every word up. */
export function namePrefixes(prefix: string): string[] {
  const lower = prefix.toLocaleLowerCase("fr");
  const first = lower.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("fr"));
  const words = lower.replace(/(^|[\s'’-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toLocaleUpperCase("fr"));
  return [...new Set([prefix, first, words])];
}
