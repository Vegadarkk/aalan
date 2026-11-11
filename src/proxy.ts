// Edge of the app (§4): admin host routing, locale routing, the page CSP and the page-view
// limits of the server-rendered pages (§6, design D14).
// NOT an authorization barrier (CVE-2025-29927): every route handler and protected layout
// runs its own guards.

import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { DEFAULT_LOCALE, LOCALES, PRIVATE_SEGMENTS } from "@/config/site";
import { DEVICE_COOKIE, SESSION_COOKIE, setDeviceCookie } from "@/lib/security/cookies";
import { buildCsp, createNonce, INLINE_HASH_MARKER, type CspVariant } from "@/lib/security/csp";
import { PINNED_SCRIPT_HASHES } from "@/lib/security/inline-hashes";
import { DEVICE_ID_HEADER, newDeviceCookie, readDeviceId } from "@/lib/security/device";
import { coopFor, META_SIGNUP_ADMIN_PATH } from "@/lib/security/headers";
import { checkPageLimits, isMeteredPath, pathLocale, tooManyPagesHtml, TOO_MANY_CSP } from "@/lib/rate-limit/proxy-limits";
import { challengeUrlPath } from "@/lib/security/challenge-path";
import { mediaBaseUrl } from "@/lib/storage/keys";
import { robotsTag } from "@/lib/security/robots";
import { closedDecision, isClosed, OPENING_SEGMENT, parseOpensAt } from "@/lib/launch/gate";
import { hasPreviewPass, PREVIEW_COOKIE } from "@/lib/launch/preview";

const handleI18nRouting = createMiddleware(routing);

/** API paths served on the admin host; every other /api path answers 404 there. */
const ADMIN_HOST_API = /^\/api\/(admin(\/|$)|health$|csp-report$)/;

/** Host without port or trailing dot ("admin.localhost:3100" in e2e, "admin.aalan.ma" deployed). */
function normalizeHost(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

function notFound(): NextResponse {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Origin of the Sentry ingest host named by the DSN (connect-src), or undefined. */
function sentryOrigin(dsn: string | undefined): string | undefined {
  if (!dsn) return undefined;
  try {
    return new URL(dsn).origin;
  } catch {
    return undefined;
  }
}

/**
 * Where photos come from (img-src): MEDIA_BASE_URL when set, else the dev storage route on the
 * public origin, which the admin host (another origin) must allow too. Null outside dev without it.
 */
function mediaOrigin(): string | undefined {
  try {
    return mediaBaseUrl() ?? undefined;
  } catch {
    return undefined;
  }
}

function cspHeaderName(): string {
  return process.env.CSP_REPORT_ONLY === "true" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/** AdSense hosts go into the CSP of ad pages once a publisher id is configured (phase 6, D10). */
function adsConfigured(): boolean {
  return Boolean(process.env.ADSENSE_CLIENT_ID);
}

function csp(variant: CspVariant, nonce?: string, scriptHashes?: readonly string[], ads?: "strict" | "broad", facebookLogin = false): string {
  return buildCsp({
    variant,
    nonce,
    scriptHashes,
    ads,
    facebookLogin,
    dev: process.env.NODE_ENV === "development",
    mediaOrigin: mediaOrigin(),
    r2Origin: process.env.R2_S3_ENDPOINT,
    tilesOrigin: process.env.MAP_PMTILES_URL,
    errorIngestOrigin: sentryOrigin(process.env.SENTRY_DSN),
    authEmulatorOrigin: process.env.FIREBASE_AUTH_EMULATOR_HOST ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}` : undefined,
    reportPath: "/api/csp-report",
    // Deployed sites are https only; a production build served on http://127.0.0.1 (e2e) is not.
    upgradeInsecure: (process.env.SITE_URL ?? "").startsWith("https://"),
  });
}

/**
 * Headers shared by every page response. `adsTwin`: the strict AdSense policy, sent report-only
 * beside the enforced broad one so the reports fix the host list (D10).
 */
function decorate(response: NextResponse, host: "public" | "admin", policy: string, adsTwin?: string, popups = false): NextResponse {
  response.headers.set(cspHeaderName(), policy);
  if (adsTwin && cspHeaderName() === "Content-Security-Policy") response.headers.set("Content-Security-Policy-Report-Only", adsTwin);
  response.headers.set("Cross-Origin-Opener-Policy", coopFor(host, popups));
  response.headers.set("Reporting-Endpoints", 'csp="/api/csp-report"');
  return response;
}

/** Robots header of a page response (src/lib/security/robots.ts). */
function withRobots(response: NextResponse, host: "public" | "admin", pathname: string): NextResponse {
  const tag = robotsTag(host, pathname);
  if (tag) response.headers.set("X-Robots-Tag", tag);
  return response;
}

/** The request headers as the locale routing left them (its request header overrides applied). */
function routedRequestHeaders(routed: NextResponse, request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  const overridden = routed.headers.get("x-middleware-override-headers");
  if (overridden) {
    for (const name of overridden.split(",")) {
      const value = routed.headers.get(`x-middleware-request-${name}`);
      if (value !== null) headers.set(name, value);
    }
  }
  return headers;
}

/** Response headers of the locale routing (its cookies aside: shared pages carry none). */
function copyRoutedHeaders(routed: NextResponse, response: NextResponse): NextResponse {
  routed.headers.forEach((value, key) => {
    if (!key.startsWith("x-middleware-") && key !== "set-cookie") response.headers.set(key, value);
  });
  return response;
}

/** Answers that never reach the edge cache: the gate's redirects and its 503. */
const NO_STORE = "no-store";

/**
 * Pre-opening gate (src/lib/launch/gate.ts): null when the request goes on as usual. Closed (before
 * OPENS_AT, no preview pass): /{locale} is rendered by the countdown page, the legal texts and
 * the procedures guide pass, any other page goes to /{locale} (307, never cached) and the public API answers 503. The
 * countdown page itself is only reached by that rewrite: asked for directly, it is the home page.
 */
function launchGate(request: NextRequest, routed: NextResponse | null): NextResponse | null {
  const { pathname } = request.nextUrl;
  const [, first = "", segment = ""] = pathname.split("/");
  const home = (locale: string) => {
    const response = NextResponse.redirect(new URL(`/${locale}`, request.url), 307);
    response.headers.set("Cache-Control", NO_STORE);
    return response;
  };
  if (segment === OPENING_SEGMENT && (LOCALES as readonly string[]).includes(first)) return home(first);
  const opensAt = parseOpensAt(process.env.OPENS_AT);
  if (!isClosed(opensAt) || hasPreviewPass(request.cookies.get(PREVIEW_COOKIE)?.value, process.env.PREVIEW_SECRET)) return null;
  const decision = closedDecision(pathname, LOCALES, DEFAULT_LOCALE);
  switch (decision.kind) {
    case "pass":
      return null;
    case "redirect-home":
      return home(decision.locale);
    case "closed-api": {
      const retry = Math.max(1, Math.ceil(((opensAt?.getTime() ?? Date.now()) - Date.now()) / 1000));
      return NextResponse.json(
        { error: "closed", message: "Le site ouvre bientôt.", opensAt: opensAt?.toISOString() },
        { status: 503, headers: { "Cache-Control": NO_STORE, "Retry-After": String(Math.min(retry, 86_400)) } },
      );
    }
    case "closed-home": {
      const url = request.nextUrl.clone();
      url.pathname = `/${decision.locale}/${OPENING_SEGMENT}`;
      const rewritten = NextResponse.rewrite(url, { request: { headers: routed ? routedRequestHeaders(routed, request) : new Headers(request.headers) } });
      // A shared page like the home it stands for: hash CSP, no cookie, cached by the edge for its
      // short ISR time (src/app/[locale]/(closed)/ouverture/page.tsx).
      const response = withRobots(decorate(routed ? copyRoutedHeaders(routed, rewritten) : rewritten, "public", csp("public")), "public", pathname);
      response.headers.set(INLINE_HASH_MARKER, "1");
      response.headers.delete("set-cookie");
      return response;
    }
  }
}

/**
 * Forwards the request to the app with extra request headers (the nonce and the CSP, read by
 * Next.js to stamp its scripts; the verified device id of a private page), keeping what the locale
 * routing decided: rewrite target, request header overrides, cookies and response headers.
 */
function forwardWithNonce(routed: NextResponse, request: NextRequest, policy: string, nonce: string, deviceId?: string): NextResponse {
  const headers = routedRequestHeaders(routed, request);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  // Read by the (account) layout to send an anonymous visitor back here after sign-in.
  headers.set("x-pathname", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  // Private pages only: the device the cookie names (or the one this response creates), read by
  // the auth pages for the Google sign-in nonce. Never the client's value (stripped in proxy()).
  headers.delete(DEVICE_ID_HEADER);
  if (deviceId) headers.set(DEVICE_ID_HEADER, deviceId);

  const rewrite = routed.headers.get("x-middleware-rewrite");
  const response = copyRoutedHeaders(
    routed,
    rewrite ? NextResponse.rewrite(new URL(rewrite, request.url), { request: { headers } }) : NextResponse.next({ request: { headers } }),
  );
  for (const cookie of routed.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

function adminHost(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) return ADMIN_HOST_API.test(pathname) ? NextResponse.next() : notFound();

  const nonce = createNonce();
  // Meta's Embedded Signup (Facebook SDK + login popup) runs on one admin page only.
  const metaSignup = pathname === META_SIGNUP_ADMIN_PATH;
  const policy = csp("private", nonce, undefined, undefined, metaSignup);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? "/admin" : `/admin${pathname}`;
  return withRobots(decorate(NextResponse.rewrite(url, { request: { headers } }), "admin", policy, undefined, metaSignup), "admin", url.pathname);
}

/**
 * Public ISR segments whose pages never read the query string ("" is the home page): categories,
 * help, legal texts, prices, Pro and procedures pages, the shop directory. Search, listings,
 * profiles, shops and the private pages keep theirs.
 */
const QUERYLESS_SEGMENTS: ReadonlySet<string> = new Set(["", "c", "aide", "legal", "tarifs", "professionnels", "demarches", "boutiques"]);

/** Pages of the account area (src/app/[locale]/(private)/(account)): a member session is required. */
const MEMBER_SEGMENTS: ReadonlySet<string> = new Set(["deposer", "favoris", "mes-annonces", "mes-avis", "messages", "parametres", "porte-monnaie", "pro", "recherches", "verifications"]);
/** /recours reads signed out only with the signed link of a decision mail (?jeton=, decisions/contracts.ts APPEAL_TOKEN_PARAM). */
const APPEALS_SEGMENT = "recours";
const APPEAL_LINK_PARAM = "jeton";

function needsSession(request: NextRequest, segment: string): boolean {
  if (MEMBER_SEGMENTS.has(segment)) return true;
  return segment === APPEALS_SEGMENT && !request.nextUrl.searchParams.get(APPEAL_LINK_PARAM);
}

/** Second path segment: "/fr/connexion/..." -> "connexion". */
function pageSegment(pathname: string): string {
  return pathname.split("/")[2] ?? "";
}

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_SEGMENTS.includes(pageSegment(pathname));
}

/**
 * Public pages rendered per request and streamed (Suspense): React's inline streaming scripts
 * ($RC...) change with every response and match no framework shape of the hash CSP, so these
 * pages take the nonce CSP of private pages. They are never cached anyway. Their layout is the
 * public one, whose theme script has no nonce: its pinned hash is allowed instead.
 */
const DYNAMIC_PUBLIC_SEGMENTS: readonly string[] = ["recherche"];

/** Device cookie as a raw header: the cookies API would also write back a removed locale cookie. */
function appendDeviceCookie(response: NextResponse): void {
  const device = new NextResponse(null);
  setDeviceCookie(device, newDeviceCookie().value);
  for (const cookie of device.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
}

/**
 * Over the page-view limits (D14): without a pass, GET and HEAD go to the Turnstile page (302);
 * otherwise a small 429 page. Never cached (Cloudflare would cache a bare 302 for 20 minutes).
 */
async function pageLimitResponse(request: NextRequest): Promise<NextResponse | null> {
  const decision = await checkPageLimits(request);
  if (decision.kind === "allow") return null;
  const locale = pathLocale(request.nextUrl.pathname) ?? "fr";
  if (decision.kind === "challenge" && (request.method === "GET" || request.method === "HEAD")) {
    const target = new URL(challengeUrlPath(locale, `${request.nextUrl.pathname}${request.nextUrl.search}`), request.url);
    const response = NextResponse.redirect(target, 302);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return new NextResponse(tooManyPagesHtml(locale), {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(Math.max(1, decision.retryAfterSeconds)),
      "Content-Security-Policy": TOO_MANY_CSP,
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Internal request header: a client must never choose the device id a render trusts.
  request.headers.delete(DEVICE_ID_HEADER);
  const host = normalizeHost(request.headers.get("host"));
  const adminHostName = normalizeHost(process.env.ADMIN_HOST);
  if (adminHostName && host === adminHostName) return adminHost(request);

  const { pathname } = request.nextUrl;
  // The back office only exists on the admin host (§4).
  if (/^\/(api\/)?admin(\/|$)/.test(pathname)) return notFound();
  if (pathname.startsWith("/api/")) return launchGate(request, null) ?? NextResponse.next();

  const routed = handleI18nRouting(request);
  if (routed.status >= 300 && routed.status < 400) return routed;

  // ISR pages that read no query (D15, audit D-5): `?x=` would bypass the edge cache and reach the
  // origin unmetered, so it goes to the clean path. Next strips `_rsc` from nextUrl before the
  // proxy, so client navigations never loop here.
  if (QUERYLESS_SEGMENTS.has(pageSegment(pathname)) && request.nextUrl.search) {
    const clean = request.nextUrl.clone();
    clean.search = "";
    return NextResponse.redirect(clean, 308);
  }

  // Before the opening, the countdown (src/lib/launch/gate.ts).
  const gated = launchGate(request, routed);
  if (gated) return gated;

  // Page-view limits (D14). RSC and prefetch requests count too: a scraper can send `RSC: 1`.
  if (isMeteredPath(pathname)) {
    const limited = await pageLimitResponse(request);
    if (limited) return limited;
  }

  // A member page opened without a session cookie goes to the sign-in page from here: rendered,
  // its layout's redirect carried the whole sign-in page (~360 KB, ZAP 10044), a cheap
  // amplification for anonymous requests. A cookie that turns out invalid is still sent there by
  // the layout. Same target as the layout: /{locale}/connexion?next=<path and query>.
  if (needsSession(request, pageSegment(pathname)) && !request.cookies.get(SESSION_COOKIE)?.value && (request.method === "GET" || request.method === "HEAD")) {
    const login = new URL(`/${pathLocale(pathname) ?? "fr"}/connexion`, request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login, 307);
  }

  const dynamicPublic = DYNAMIC_PUBLIC_SEGMENTS.includes(pageSegment(pathname));
  if (isPrivatePath(pathname) || dynamicPublic) {
    const nonce = createNonce();
    const ads = dynamicPublic && adsConfigured();
    const policy = csp("private", nonce, dynamicPublic ? [...PINNED_SCRIPT_HASHES] : undefined, ads ? "broad" : undefined);
    const deviceId = readDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
    if (dynamicPublic) {
      const twin = ads ? csp("private", nonce, [...PINNED_SCRIPT_HASHES], "strict") : undefined;
      const response = withRobots(decorate(forwardWithNonce(routed, request, policy, nonce), "public", policy, twin), "public", pathname);
      // Like shared pages, no locale cookie. The device cookie makes the per-device search limits
      // apply (D13) instead of the anonymous bucket of the IP. It is not forwarded to this render:
      // a request without it is an unknown device on its IP (§6), or dropping cookies would skip
      // the device limits; over that bucket, a first search escalates to Turnstile.
      response.headers.delete("set-cookie");
      if (!deviceId) appendDeviceCookie(response);
      return response;
    }
    // The device cookie exists before the first API call: sign-up and sign-in limits are counted
    // per device, and a browser without the cookie would share the anonymous bucket of its IP
    // (src/lib/rate-limit/keys.ts). Private pages are dynamic, so the cookie costs no cache. The
    // render gets the id (x-device-id) the cookie names, or the one set here: the auth pages derive
    // the Google sign-in nonce from it, and the API recomputes it from the same cookie.
    const fresh = deviceId ? null : newDeviceCookie();
    const response = withRobots(decorate(forwardWithNonce(routed, request, policy, nonce, fresh?.id ?? deviceId ?? undefined), "public", policy), "public", pathname);
    if (fresh) setDeviceCookie(response, fresh.value);
    return response;
  }
  // Fallback policy; the server hook swaps 'unsafe-inline' for the hashes of this HTML.
  const ads = adsConfigured();
  const response = withRobots(decorate(routed, "public", csp("public", undefined, undefined, ads ? "broad" : undefined), ads ? csp("public", undefined, undefined, "strict") : undefined), "public", pathname);
  response.headers.set(INLINE_HASH_MARKER, "1");
  // Shared pages carry no cookie, so Cloudflare can cache them. The locale cookie is written by
  // the locale switcher (next-intl Link) and still read here for the "/" redirect.
  response.headers.delete("set-cookie");
  return response;
}

export const config = {
  // Everything but build assets and files with an asset extension (brand images, map worker,
  // robots.txt, ads.txt, sitemaps). Any other dotted path (`/fr/annonce/x.1-{id}`) still gets the
  // CSP and the page limits set here. Under /api, /admin and the locales an asset extension skips
  // nothing: `/api/listings/x.json` or `/fr/deposer/x.png` reached its handler past the launch gate
  // and the admin-host check (closed-site audit, 11 Nov 2026). Locales spelled out: the matcher
  // must be a literal. tests/unit/proxy.test.ts checks both lists.
  matcher: ["/((?!_next/static|_next/image|(?!(?:api|admin|fr|ar|rif)/).*\\.(?:svg|png|jpe?g|webp|avif|gif|ico|txt|xml|json|webmanifest|js|mjs|css|map|woff2?|wasm)$).*)"],
};
