// Pre-opening gate (owner, 5 Nov 2026): production goes online about ten days before the site
// opens, while the social-media campaign runs. Until OPENS_AT the site is closed: the home page of
// each locale shows the welcome door, shut, with a countdown (src/app/[locale]/(closed)/ouverture);
// every other page goes to it, except the legal texts; the public API answers 503, except health,
// runtime config, CSP reports, the preview pass and the providers' webhooks. No sign-up, no listing
// (owner's card: "Non, tout fermé"). The admin host is never gated. Unset or past OPENS_AT: open.
// A preview pass (src/lib/launch/preview.ts) lets the team through before the opening.
// Pure and environment-free: imported by the proxy, the closed page and the tests.

/** Path segment of the closed home page, reached only by the proxy's rewrite of /{locale}. */
export const OPENING_SEGMENT = "ouverture";

/**
 * OPENS_AT: an ISO 8601 date and time with its offset ("2026-11-20T10:00:00+01:00" or "...Z"),
 * minutes at least. Anything else is refused (env.ts fails the start), so a typo never decides.
 */
const OPENS_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The opening instant, or null when unset or invalid (the site is then open). */
export function parseOpensAt(raw: string | undefined): Date | null {
  const value = raw?.trim();
  if (!value || !OPENS_AT_PATTERN.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Whether OPENS_AT holds a value parseOpensAt refuses. */
export function invalidOpensAt(raw: string | undefined): boolean {
  return Boolean(raw?.trim()) && parseOpensAt(raw) === null;
}

/** True before the opening instant. */
export function isClosed(opensAt: Date | null, now: Date = new Date()): boolean {
  return opensAt !== null && now.getTime() < opensAt.getTime();
}

/** Page segments still served while closed: the legal texts (mentions, CGU, privacy, cookies). */
const OPEN_PAGE_SEGMENTS: ReadonlySet<string> = new Set(["legal"]);

/**
 * Public API paths still served while closed: health (uptime probe), the browser's config, CSP
 * reports, the preview pass, the providers' webhooks (Stripe, RevenueCat, mail, WhatsApp) and the
 * sign-out (a session from before the gate can always end).
 */
const OPEN_API = /^\/api\/(?:health|config|csp-report|preview|auth\/logout|webhooks\/[a-z]+)\/?$/;

export type ClosedDecision =
  /** Served as is. */
  | { kind: "pass" }
  /** /{locale}: rendered by the closed home page. */
  | { kind: "closed-home"; locale: string }
  /** Any other page: sent to /{locale}. */
  | { kind: "redirect-home"; locale: string }
  /** Public API: 503. */
  | { kind: "closed-api" };

/**
 * What a public-host request becomes while the site is closed, for a pathname already carrying
 * its locale (the proxy runs the locale routing first). `locale`: the first segment when it is
 * one of `locales`, else the default.
 */
export function closedDecision(pathname: string, locales: readonly string[], fallbackLocale: string): ClosedDecision {
  if (pathname.startsWith("/api/")) return OPEN_API.test(pathname) ? { kind: "pass" } : { kind: "closed-api" };
  const [, first = "", segment = ""] = pathname.split("/");
  const locale = locales.includes(first) ? first : fallbackLocale;
  if (!locales.includes(first)) return { kind: "redirect-home", locale };
  if (segment === "") return { kind: "closed-home", locale };
  if (OPEN_PAGE_SEGMENTS.has(segment)) return { kind: "pass" };
  return { kind: "redirect-home", locale };
}

/** Whole time left, split for the countdown; zeros once the instant has passed. */
export function timeLeft(opensAt: number, now: number): { days: number; hours: number; minutes: number; seconds: number; total: number } {
  const total = Math.max(0, Math.floor((opensAt - now) / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    total,
  };
}
