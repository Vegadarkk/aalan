import { findContacts } from "@/lib/moderation/contacts";

// A display name shows on every listing and in every conversation: a phone number or a link in it
// would bypass "messaging is the only channel" (audit zone 1 Z1-04, synthesis B6). Pure and light
// (no libphonenumber), so the sign-up and settings forms check it as typed and the API again.
//
// Phones: a name never needs 6 digits, and every phone number written with digits (Moroccan or
// foreign, spaced, dotted, "o" for zero aside) has more; Arabic-Indic digits count too. Links and
// e-mails: the listing detector (bare domains, "www.", messaging hosts).

/** Digits a display name may hold ("Garage 2000", "Riad 7"): fewer than a phone number. */
export const DISPLAY_NAME_MAX_DIGITS = 5;

export type DisplayNameContact = "phone" | "link";

export function displayNameContact(name: string): DisplayNameContact | null {
  const digits = name.match(/\p{Nd}/gu)?.length ?? 0;
  if (digits > DISPLAY_NAME_MAX_DIGITS) return "phone";
  return findContacts(name).length > 0 ? "link" : null;
}
