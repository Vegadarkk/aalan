import { findContacts } from "@/lib/moderation/contacts";
import { findPhoneNumbers } from "@/lib/moderation/phones";

// The passages of a text that a pattern blocker is about (a phone number, an e-mail, a link), as
// written, so the wizard can quote and select them next to the server's reason (zone 3 P2-9).
// Same detectors as the server's screen (screen.ts steps 2-3); pure and client-safe, loaded by the
// wizard only when such a blocker is shown (libphonenumber metadata stays out of the usual bundle).

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

/** Passages of `text` behind the blocker `code`; [] for a code that is not about a passage. */
export function blockerPassages(code: string, text: string): string[] {
  if (!text) return [];
  if (code === "phone_in_text") return unique(findPhoneNumbers(text).map((match) => match.raw));
  if (code === "email_in_text") return unique(findContacts(text).filter((match) => match.kind === "email").map((match) => match.raw));
  if (code === "url_in_text") return unique(findContacts(text).filter((match) => match.kind === "url").map((match) => match.raw));
  return [];
}
