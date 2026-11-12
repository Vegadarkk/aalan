import "server-only";
import { pepperedHash, safeEqual } from "@/lib/security/hash";
import { normalizeEmail } from "@/lib/security/email-normalize";

// Signed links of the opening list (owner, 2026-11-12). Nothing is stored before the confirmation:
// the confirm token carries the address, its language and an expiry, signed under HASH_PEPPER
// (purpose "newsletter-confirm"), so an unconfirmed address leaves no trace in the database. The
// unsubscribe token names the subscriber's document (the peppered hash of the normalized address)
// and never expires (RFC 8058: an old e-mail must still unsubscribe); it can do nothing else.
// Token = base64url(payload) + "." + HMAC of the payload (43 characters).

export type NewsletterLang = "fr" | "ar" | "rif";

/** How long a confirmation link works (the confirmation e-mail says 48 hours). */
export const CONFIRM_TTL_MS = 48 * 3_600_000;

const CONFIRM = { purpose: "newsletter-confirm", version: "c1" } as const;
const UNSUBSCRIBE = { purpose: "newsletter-unsubscribe", version: "u1" } as const;
const LANGS: ReadonlySet<string> = new Set(["fr", "ar", "rif"]);
const SUBSCRIBER_ID = /^[A-Za-z0-9_-]{43}$/;

/** Document id of an address in `newsletter`: one per person, whatever its Gmail dots or +tag. */
export function subscriberId(email: string): string {
  return pepperedHash("newsletter-email", normalizeEmail(email));
}

function sign(purpose: string, payload: string): string {
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${pepperedHash(purpose, payload)}`;
}

/** The payload of a well-formed token signed for `purpose`, else null. */
function open(purpose: string, token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  return safeEqual(pepperedHash(purpose, payload), sig) ? payload : null;
}

export interface ConfirmTarget {
  email: string;
  lang: NewsletterLang;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export function confirmToken(email: string, lang: NewsletterLang, now = Date.now()): string {
  if (!LANGS.has(lang) || email.includes("\n")) throw new Error("invalid newsletter confirmation");
  const expiresAt = Math.floor((now + CONFIRM_TTL_MS) / 1000);
  return sign(CONFIRM.purpose, [CONFIRM.version, Buffer.from(email, "utf8").toString("base64url"), lang, String(expiresAt)].join("."));
}

/** The address of a valid, unexpired confirmation token; null for anything else. */
export function verifyConfirmToken(token: string, now = Date.now()): ConfirmTarget | null {
  const payload = open(CONFIRM.purpose, token);
  if (!payload) return null;
  const [version, encodedEmail, lang, expires, ...rest] = payload.split(".");
  if (version !== CONFIRM.version || rest.length > 0 || !encodedEmail || !lang || !LANGS.has(lang) || !/^\d{9,11}$/.test(expires ?? "")) return null;
  const expiresAt = Number(expires) * 1000;
  if (expiresAt <= now) return null;
  const email = Buffer.from(encodedEmail, "base64url").toString("utf8");
  if (!email.includes("@") || email.length > 254) return null;
  return { email, lang: lang as NewsletterLang, expiresAt };
}

export function unsubscribeToken(email: string): string {
  return sign(UNSUBSCRIBE.purpose, `${UNSUBSCRIBE.version}.${subscriberId(email)}`);
}

/** The subscriber document a valid unsubscribe token names, else null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const payload = open(UNSUBSCRIBE.purpose, token);
  if (!payload) return null;
  const [version, id, ...rest] = payload.split(".");
  return version === UNSUBSCRIBE.version && rest.length === 0 && id && SUBSCRIBER_ID.test(id) ? id : null;
}
