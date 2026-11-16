// Pre-opening gate (owner, 5 Nov 2026): production goes online about ten days before the site
// opens, while the social-media campaign runs. Until OPENS_AT the site is closed: the home page of
// each locale shows the welcome door, shut, with a countdown (src/app/[locale]/(closed)/ouverture);
// every other page goes to it, except the legal texts and the procedures guide; the public API
// answers 503, except health, runtime config, CSP reports, the preview pass and the providers'
// webhooks. No sign-up, no listing
// (owner's card: "Non, tout fermé"). Sign-up opens SIGNUP_LEAD_MS before OPENS_AT (owner's card,
// 16 Nov 2026: "Oui, inscriptions à J-1"): accounts, sign-in, settings, phone check and the Pro
// application pass; listings, search and messaging stay closed until OPENS_AT. The admin host is
// never gated. Unset or past OPENS_AT: open.
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

/** Sign-up opens this long before the opening (owner, 16 Nov 2026: J-1). */
export const SIGNUP_LEAD_MS = 24 * 3_600_000;

/** closed: only the door; signup: accounts too (the day before); open: everything. */
export type LaunchPhase = "closed" | "signup" | "open";

export function launchPhase(opensAt: Date | null, now: Date = new Date()): LaunchPhase {
  if (!isClosed(opensAt, now) || !opensAt) return "open";
  return now.getTime() >= opensAt.getTime() - SIGNUP_LEAD_MS ? "signup" : "closed";
}

/** True before the opening instant. */
export function isClosed(opensAt: Date | null, now: Date = new Date()): boolean {
  return opensAt !== null && now.getTime() < opensAt.getTime();
}

/**
 * Page segments still served while closed: the legal texts (mentions, CGU, privacy, cookies) and
 * the admin procedures guide, its rubrics included (owner, 11 Nov 2026: the guide opens before the
 * site so search engines index it early; sign-up, listings and the API stay closed), and the
 * opening list's unsubscribe page (owner, 16 Nov 2026: its e-mails start 7 days before the opening).
 */
export const OPEN_PAGE_SEGMENTS: ReadonlySet<string> = new Set(["legal", "demarches", "liste-ouverture"]);

/**
 * Public API paths still served while closed: health (uptime probe), the browser's config, CSP
 * reports, the preview pass, the providers' webhooks (Stripe, RevenueCat, mail, WhatsApp), the
 * sign-out (a session from before the gate can always end) and the opening list (owner, 12 Nov
 * 2026: the door takes e-mail sign-ups, src/lib/newsletter).
 */
const OPEN_API = /^\/api\/(?:health|config|csp-report|preview|auth\/logout|webhooks\/[a-z]+|newsletter\/(?:subscribe|confirm|unsubscribe))\/?$/;

/**
 * Pages added the day before the opening (owner, 16 Nov 2026): sign-in and sign-up, the e-mail
 * action links, the account settings and phone check, the Pro area (application, KYBC, shop card)
 * and the anti-robot challenge. Posting, search, messaging and favorites wait for OPENS_AT.
 */
export const SIGNUP_PAGE_SEGMENTS: ReadonlySet<string> = new Set(["connexion", "inscription", "mot-de-passe-oublie", "action", "parametres", "verifications", "pro", "anti-robot"]);

/**
 * API added the day before the opening: every /api/auth and /api/account route, the Pro
 * application, its KYBC pieces and the shop's own settings (/api/pro/me/**), and the challenge
 * pass. Not /api/pro/stock, fleet or departures (they publish), nor the listings, uploads, wallet
 * or billing routes.
 */
const SIGNUP_API = /^\/api\/(?:auth\/[a-z]+(?:\/[a-z]+)?|account\/[a-z]+|pro\/apply|pro\/me(?:\/[a-z]+){0,2}|pro\/kybc\/uploads(?:\/[A-Za-z0-9_-]{1,64}(?:\/complete)?)?|challenge\/pass)\/?$/;

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
 * its locale (the proxy runs the locale routing first); `phase` "signup" adds the sign-up pages
 * and API of the day before. `locale`: the first segment when it is
 * one of `locales`, else the default.
 */
export function closedDecision(pathname: string, locales: readonly string[], fallbackLocale: string, phase: Exclude<LaunchPhase, "open"> = "closed"): ClosedDecision {
  const signup = phase === "signup";
  if (pathname.startsWith("/api/")) return OPEN_API.test(pathname) || (signup && SIGNUP_API.test(pathname)) ? { kind: "pass" } : { kind: "closed-api" };
  const [, first = "", segment = ""] = pathname.split("/");
  const locale = locales.includes(first) ? first : fallbackLocale;
  if (!locales.includes(first)) return { kind: "redirect-home", locale };
  if (segment === "") return { kind: "closed-home", locale };
  if (OPEN_PAGE_SEGMENTS.has(segment) || (signup && SIGNUP_PAGE_SEGMENTS.has(segment))) return { kind: "pass" };
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
