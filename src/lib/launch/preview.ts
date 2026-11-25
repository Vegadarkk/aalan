import { createHmac, timingSafeEqual } from "node:crypto";

// Preview pass of the closed site (src/lib/launch/gate.ts): the team checks production before the
// opening. GET /api/preview?cle=<PREVIEW_SECRET> sets an HttpOnly cookie holding an HMAC of a fixed
// label under the secret (never the secret itself); the proxy lets a request carrying it through
// the gate. Changing PREVIEW_SECRET revokes every pass. Cloudflare bypasses its cache for a
// request with this cookie (infra/cloudflare/cache-rules.json), so an opened page is never cached
// for the visitors still in front of the door.

export const PREVIEW_COOKIE = "__Host-preview";
export const PREVIEW_SECONDS = 30 * 24 * 60 * 60;
/** Shortest accepted secret (env.ts refuses a shorter one). */
export const PREVIEW_SECRET_MIN = 32;
const LABEL = "aalan-preview-v1";

/** The cookie value of a pass under `secret`. */
export function previewPass(secret: string): string {
  return createHmac("sha256", secret).update(LABEL).digest("base64url");
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether `value` (the cookie) is a pass under the configured secret; false without a usable secret. */
export function hasPreviewPass(value: string | undefined, secret: string | undefined): boolean {
  if (!value || !secret || secret.length < PREVIEW_SECRET_MIN) return false;
  return same(value, previewPass(secret));
}

/** Whether `key` (typed by the team) is the configured secret. */
export function isPreviewKey(key: string | null | undefined, secret: string | undefined): boolean {
  if (!key || !secret || secret.length < PREVIEW_SECRET_MIN) return false;
  // Compared through their HMACs: equal lengths whatever was typed.
  return same(previewPass(key), previewPass(secret));
}

// Pro invitation pass (owner's card, 24 Nov 2026): the outreach mail to shops carries
// /api/preview?pro=<PRO_INVITE_CODE>; the pass it sets (same cookie, so the edge cache bypass
// holds) opens the sign-up rooms and posting, not the public site (gate.ts, access "pro"). Its
// value is an HMAC under PREVIEW_SECRET of the code: changing either revokes every invitation.
const PRO_LABEL = "aalan-pro-invite-v1";
/** Shortest accepted invitation code (env.ts refuses a shorter one). */
export const PRO_INVITE_CODE_MIN = 16;

function usable(secret: string | undefined, code: string | undefined): secret is string {
  return Boolean(secret && secret.length >= PREVIEW_SECRET_MIN && code && code.length >= PRO_INVITE_CODE_MIN);
}

/** The cookie value of a Pro invitation pass for `code` under `secret`. */
export function proInvitePass(secret: string, code: string): string {
  return createHmac("sha256", secret).update(`${PRO_LABEL}:${code}`).digest("base64url");
}

/** Whether `value` (the cookie) is a Pro invitation pass; false unless both secret and code are set. */
export function hasProInvitePass(value: string | undefined, secret: string | undefined, code: string | undefined): boolean {
  if (!value || !usable(secret, code)) return false;
  return same(value, proInvitePass(secret, code as string));
}

/** Whether `key` (from the mail's link) is the configured invitation code. */
export function isProInviteCode(key: string | null | undefined, secret: string | undefined, code: string | undefined): boolean {
  if (!key || !usable(secret, code)) return false;
  return same(proInvitePass(secret, key), proInvitePass(secret, code as string));
}
