import "server-only";
import { findContacts } from "@/lib/moderation/contacts";
import { findPhoneNumbers } from "@/lib/moderation/phones";

// PII masking before any provider call (architecture §7 "masquer téléphones, e-mails, noms avant
// tout appel", design D19). Phones (libphonenumber + Moroccan shapes, src/lib/moderation/phones.ts),
// e-mails and links (src/lib/moderation/contacts.ts) and the known names of the people involved
// (seller, buyer, reporter, affected user) become neutral placeholders. Pure.

export const MASKS = { phone: "[téléphone]", email: "[e-mail]", url: "[lien]", name: "[nom]" } as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names shorter than this are not masked on their own (initials, "Ali" inside words is guarded by boundaries). */
const NAME_MIN = 2;

function replaceAllLiteral(text: string, needle: string, replacement: string): string {
  return needle ? text.split(needle).join(replacement) : text;
}

/**
 * Replaces each known name (whole word, any case) by `[nom]`; longer names first. `masked` counts
 * the places replaced: a member chooses their display name, so a name made of ordinary words hides
 * those words from the agent; the listing screen keeps a listing its seller's name masks in more
 * than one place for a moderator (facts.nameMasks, src/lib/ai/apply.ts).
 */
export function maskNamesCounted(text: string, names: readonly (string | null | undefined)[]): { text: string; masked: number } {
  const unique = [...new Set(names.map((name) => (name ?? "").trim()).filter((name) => name.length >= NAME_MIN))].sort((a, b) => b.length - a.length);
  let out = text;
  let masked = 0;
  const mask = () => {
    masked += 1;
    return MASKS.name;
  };
  for (const name of unique) {
    // Unicode-aware word boundaries: a name is not masked inside a longer word.
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(pattern, mask);
    // Each part of a multi-word name too ("Karim Benali" -> "Karim", "Benali").
    for (const part of name.split(/\s+/)) {
      if (part.length < 3 || part === name) continue;
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, "giu"), mask);
    }
  }
  return { text: out, masked };
}

export function maskNames(text: string, names: readonly (string | null | undefined)[]): string {
  return maskNamesCounted(text, names).text;
}

/** Text with phones, e-mails, links and the given names masked; `masked` as in maskNamesCounted. */
export function maskPiiCounted(text: string, names: readonly (string | null | undefined)[] = []): { text: string; masked: number } {
  if (!text) return { text: "", masked: 0 };
  let out = text;
  // E-mails and links first: a phone number inside a URL is masked with the URL.
  for (const contact of findContacts(out)) out = replaceAllLiteral(out, contact.raw, contact.kind === "email" ? MASKS.email : MASKS.url);
  for (const phone of findPhoneNumbers(out)) out = replaceAllLiteral(out, phone.raw, MASKS.phone);
  return maskNamesCounted(out, names);
}

/** Text with phones, e-mails, links and the given names masked. */
export function maskPii(text: string, names: readonly (string | null | undefined)[] = []): string {
  return maskPiiCounted(text, names).text;
}
