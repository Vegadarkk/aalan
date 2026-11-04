import type { AuthorityTargetCandidate } from "@/lib/decisions/contracts";
import { AUTHORITY_SCOPE_PATTERN } from "@/lib/decisions/contracts";
import { ACCOUNT_STATUS_LABEL, plural } from "./moderation-format";

// Lines of the authority form's content picker (audit zone 7 P3-4): what the admin reads to
// recognise a content before recording the request. Pure and client-safe.

export const LISTING_STATUS_LABEL: Record<string, string> = {
  draft: "brouillon",
  pending_review: "en vérification",
  published: "en ligne",
  paused: "en pause",
  expired: "expirée",
  sold: "vendue",
  rejected: "refusée",
  removed: "retirée",
};

const number = new Intl.NumberFormat("fr-FR");

export function candidatePrice(price: number | null, isDonation: boolean): string {
  if (isDonation) return "don";
  if (price === null) return "prix à discuter";
  return `${number.format(price)} DH`;
}

export interface CandidateLines {
  /** What the content is ("Annonce", "Compte", "Conversation"). */
  kind: string;
  title: string;
  detail: string;
}

export function candidateLines(candidate: AuthorityTargetCandidate): CandidateLines {
  if (candidate.kind === "listing") {
    const parts = [LISTING_STATUS_LABEL[candidate.status] ?? candidate.status, candidatePrice(candidate.price, candidate.isDonation)];
    if (candidate.city) parts.push(candidate.city);
    if (candidate.ownerName) parts.push(`par ${candidate.ownerName}`);
    return { kind: "Annonce", title: candidate.title || "Sans titre", detail: capitalize(parts.join(", ")) };
  }
  if (candidate.kind === "user") {
    const parts = [candidate.accountType === "pro" ? "Professionnel" : "Particulier", (ACCOUNT_STATUS_LABEL[candidate.status] ?? candidate.status).toLowerCase(), plural(candidate.activeListings, "annonce en ligne", "annonces en ligne")];
    return { kind: "Compte", title: candidate.displayName, detail: parts.join(", ") };
  }
  const parts = [`${candidate.buyerName} et ${candidate.sellerName}`, plural(candidate.messageCount, "message", "messages")];
  if (candidate.frozen) parts.push("déjà gelée");
  return { kind: "Conversation", title: `À propos de « ${candidate.listingTitle || "Sans titre"} »`, detail: parts.join(", ") };
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("fr") + text.slice(1);
}

/**
 * The queries in a paste: several links or references (one per line or separated by spaces) are
 * looked up one by one; anything else (a name, a title) is one query.
 */
export function splitPaste(raw: string, max = 10): string[] {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const reference = (token: string) => AUTHORITY_SCOPE_PATTERN.test(token) || /^https?:\/\//i.test(token) || token.startsWith("/");
  if (tokens.length > 1 && tokens.every(reference)) return [...new Set(tokens)].slice(0, max);
  const query = raw.trim();
  return query ? [query] : [];
}
