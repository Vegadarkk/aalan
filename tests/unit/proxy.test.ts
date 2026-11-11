import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { resetServerEnv } from "@/lib/env";
import { INLINE_HASH_MARKER } from "@/lib/security/csp";
import { PINNED_SCRIPT_HASHES } from "@/lib/security/inline-hashes";
import * as proxyLimits from "@/lib/rate-limit/proxy-limits";
import { APPEAL_TOKEN_PARAM } from "@/lib/decisions/contracts";

// Page-view limits (D14): the decision itself is unit-tested in proxy-limits.test.ts; here the
// spy only steers what the proxy does with it (the real check runs on the in-memory limiter).
vi.mock("@/lib/rate-limit/proxy-limits", async (importOriginal) => {
  const actual = await importOriginal<typeof proxyLimits>();
  return { ...actual, checkPageLimits: vi.fn(actual.checkPageLimits) };
});
const checkPageLimits = vi.mocked(proxyLimits.checkPageLimits);

const request = (path: string, host = "joutiya.ma") => new NextRequest(`https://${host}${path}`, { headers: { host } });
/** A request carrying a session cookie (never verified by the proxy): account pages render. */
const member = (path: string, host = "joutiya.ma") => new NextRequest(`https://${host}${path}`, { headers: { host, cookie: "__Host-session=session-cookie" } });

beforeEach(() => {
  vi.stubEnv("ADMIN_HOST", "admin.joutiya.ma");
  vi.stubEnv("APP_ENV", "prod");
  vi.stubEnv("SITE_URL", "https://joutiya.ma");
  // The media origin comes from the parsed (cached) environment.
  resetServerEnv();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

/** One directive of a policy, e.g. "img-src 'self' data: ...". */
const directive = (policy: string, name: string) => policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";

describe("proxy matcher", () => {
  it("skips build assets and asset files, never a dotted page path", () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    for (const url of ["/_next/static/chunks/a.js", "/_next/image", "/robots.txt", "/ads.txt", "/sitemap.xml", "/sitemaps/index.xml", "/brand/joutiya-icon.svg", "/vendor/maplibre-gl-5.0.0-worker.mjs"]) expect(matches(url), url).toBe(false);
    for (const url of ["/", "/fr", "/fr/annonce/velo-abcdefgh", "/fr/annonce/x.1-abcdefgh", "/fr/messages/a.b", "/comptes/a.b", "/fr/x.svg.html", "/api/health"]) expect(matches(url), url).toBe(true);
  });
});

describe("proxy", () => {
  it("hides the back office on the public host", async () => {
    for (const path of ["/admin", "/admin/x", "/api/admin/users"]) expect((await proxy(request(path))).status).toBe(404);
  });

  it("rewrites the admin host to /admin with a nonce CSP and noindex", async () => {
    const response = await proxy(request("/moderation", "admin.joutiya.ma"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://admin.joutiya.ma/admin/moderation");
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeDefined();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("serves only its own APIs on the admin host", async () => {
    expect((await proxy(request("/api/health", "admin.joutiya.ma"))).status).toBe(200);
    expect((await proxy(request("/api/health", "admin.joutiya.ma:443"))).status).toBe(200);
    expect((await proxy(request("/api/listings", "ADMIN.joutiya.ma."))).status).toBe(404);
    expect((await proxy(request("/api/listings", "admin.joutiya.ma"))).status).toBe(404);
  });

  it("redirects paths without a locale", async () => {
    const response = await proxy(request("/legal/cgu"));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toContain("/fr/legal/cgu");
  });

  it("marks public pages for inline-script hashing", async () => {
    const response = await proxy(request("/fr/legal/cgu"));
    expect(response.headers.get(INLINE_HASH_MARKER)).toBe("1");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("gives private pages a fresh nonce", async () => {
    const first = await proxy(request("/ar/connexion"));
    const second = await proxy(request("/ar/connexion"));
    expect(first.headers.get(INLINE_HASH_MARKER)).toBeNull();
    expect(first.headers.get("content-security-policy")).toContain("'strict-dynamic'");
    expect(first.headers.get("x-middleware-request-x-nonce")).not.toBe(second.headers.get("x-middleware-request-x-nonce"));
  });

  it("allows WebAssembly in the wizard (private) only", async () => {
    expect((await proxy(member("/fr/deposer"))).headers.get("content-security-policy")).toContain("'wasm-unsafe-eval'");
    expect((await proxy(request("/fr/annonce/velo-casablanca-abcd2345"))).headers.get("content-security-policy")).not.toContain("'wasm-unsafe-eval'");
  });

  it("adds the PMTiles origin to connect-src and img-src when a map is configured", async () => {
    const before = (await proxy(request("/fr/annonce/velo-casablanca-abcd2345"))).headers.get("content-security-policy") ?? "";
    expect(before).not.toContain("tiles.joutiya.ma");
    vi.stubEnv("MAP_PMTILES_URL", "https://tiles.joutiya.ma/maps/morocco.pmtiles");
    for (const path of ["/fr/annonce/velo-casablanca-abcd2345", "/fr/deposer"]) {
      const policy = (await proxy(member(path))).headers.get("content-security-policy") ?? "";
      const directive = (name: string) => policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";
      expect(directive("connect-src")).toContain("https://tiles.joutiya.ma");
      expect(directive("img-src")).toContain("https://tiles.joutiya.ma");
    }
  });

  it("gives private pages a device cookie when the request has none, and public pages never", async () => {
    const fresh = await proxy(request("/fr/connexion"));
    const cookie = fresh.cookies.get("__Host-did");
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    // A valid cookie is kept; a forged one is replaced.
    const kept = await proxy(new NextRequest("https://joutiya.ma/fr/connexion", { headers: { host: "joutiya.ma", cookie: `__Host-did=${cookie!.value}` } }));
    expect(kept.cookies.get("__Host-did")).toBeUndefined();
    const forged = await proxy(new NextRequest("https://joutiya.ma/fr/connexion", { headers: { host: "joutiya.ma", cookie: "__Host-did=aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb" } }));
    expect(forged.cookies.get("__Host-did")?.value).not.toBe("aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb");
    expect((await proxy(request("/fr"))).headers.get("set-cookie")).toBeNull();
  });

  it("tells private renders the verified device id (x-device-id), never the client's; public renders get none", async () => {
    const spoof = { "x-device-id": "spoofed-device-id-0000" };
    // The cookie this very response sets names the device the render learns.
    const fresh = await proxy(new NextRequest("https://joutiya.ma/fr/connexion", { headers: { host: "joutiya.ma", ...spoof } }));
    const value = fresh.cookies.get("__Host-did")?.value ?? "";
    const id = value.split(".")[0];
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fresh.headers.get("x-middleware-request-x-device-id")).toBe(id);
    // A valid cookie: its id, whatever the client claims.
    const kept = await proxy(new NextRequest("https://joutiya.ma/fr/inscription", { headers: { host: "joutiya.ma", cookie: `__Host-did=${value}`, ...spoof } }));
    expect(kept.headers.get("x-middleware-request-x-device-id")).toBe(id);
    expect(kept.cookies.get("__Host-did")).toBeUndefined();
    // A forged cookie is replaced: the render learns the replacement.
    const forged = await proxy(new NextRequest("https://joutiya.ma/fr/connexion", { headers: { host: "joutiya.ma", cookie: "__Host-did=aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb" } }));
    const replaced = forged.cookies.get("__Host-did")?.value.split(".")[0];
    expect(replaced).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(replaced).not.toBe("aaaaaaaaaaaaaaaaaaaaaa");
    expect(forged.headers.get("x-middleware-request-x-device-id")).toBe(replaced);
    // Shared and streamed public pages never learn a device, and the client's header is dropped there too.
    for (const path of ["/fr", "/fr/legal/cgu", "/fr/recherche?q=velo", "/fr/annonce/velo-casablanca-abcd2345"]) {
      const response = await proxy(new NextRequest(`https://joutiya.ma${path}`, { headers: { host: "joutiya.ma", cookie: `__Host-did=${value}`, ...spoof } }));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-middleware-request-x-device-id"), path).toBeNull();
      expect(response.headers.get("x-middleware-override-headers") ?? "", path).not.toContain("x-device-id");
    }
  });

  it("lets the admin host show photos from the media host, and from the public origin's dev route in development", async () => {
    vi.stubEnv("MEDIA_BASE_URL", "https://media.joutiya.ma/");
    resetServerEnv();
    const deployed = (await proxy(request("/moderation/abcd2345", "admin.joutiya.ma"))).headers.get("content-security-policy") ?? "";
    expect(directive(deployed, "img-src")).toBe("img-src 'self' data: blob: https://media.joutiya.ma");

    // Development without MEDIA_BASE_URL: photos come from /api/dev/storage on SITE_URL, another
    // origin than admin.localhost. The staff route /photos/... is same-origin ('self').
    vi.stubEnv("MEDIA_BASE_URL", "");
    vi.stubEnv("APP_ENV", "dev");
    vi.stubEnv("SITE_URL", "http://localhost:3100");
    vi.stubEnv("ADMIN_HOST", "admin.localhost");
    resetServerEnv();
    const dev = (await proxy(request("/moderation/abcd2345", "admin.localhost:3100"))).headers.get("content-security-policy") ?? "";
    expect(directive(dev, "img-src")).toContain("http://localhost:3100");
    expect(directive(dev, "img-src")).toContain("'self'");

    // Deployed without a media host: no extra origin.
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("SITE_URL", "https://staging.joutiya.ma");
    vi.stubEnv("ADMIN_HOST", "admin.staging.joutiya.ma");
    resetServerEnv();
    const bare = (await proxy(request("/moderation", "admin.staging.joutiya.ma"))).headers.get("content-security-policy") ?? "";
    expect(directive(bare, "img-src")).toBe("img-src 'self' data: blob:");
  });

  it("keeps Tarifit pages out of the production index until RIF_INDEXABLE", async () => {
    expect((await proxy(request("/fr"))).headers.get("x-robots-tag")).toBeNull();
    expect((await proxy(request("/ar/c/vehicules"))).headers.get("x-robots-tag")).toBeNull();
    for (const path of ["/rif", "/rif/c/vehicules", "/rif/connexion"]) {
      expect((await proxy(request(path))).headers.get("x-robots-tag")).toBe("noindex, follow");
    }
    vi.stubEnv("RIF_INDEXABLE", "true");
    expect((await proxy(request("/rif/c/vehicules"))).headers.get("x-robots-tag")).toBeNull();
    vi.stubEnv("APP_ENV", "staging");
    expect((await proxy(request("/rif"))).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("keeps staging out of search engines", async () => {
    vi.stubEnv("APP_ENV", "staging");
    expect((await proxy(request("/fr"))).headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("can switch the CSP to report-only", async () => {
    vi.stubEnv("CSP_REPORT_ONLY", "true");
    const response = await proxy(request("/fr"));
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("content-security-policy-report-only")).toContain("default-src 'self'");
  });

  it("sends category pages with a query string to the clean path (308)", async () => {
    const response = await proxy(request("/fr/c/vehicules/casablanca?x=123&utm_source=a"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://joutiya.ma/fr/c/vehicules/casablanca");
    expect(checkPageLimits).not.toHaveBeenCalled();
    expect((await proxy(request("/fr/c/vehicules/casablanca"))).status).toBe(200);
    // Other pages keep their query.
    expect((await proxy(request("/fr/annonce/velo-casablanca-abcd2345?ref=1"))).status).toBe(200);
  });

  it("sends an account page opened without a session cookie to the sign-in page, with its path as next (ZAP 10044)", async () => {
    const response = await proxy(request("/ar/messages/abc?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://joutiya.ma/ar/connexion?next=%2Far%2Fmessages%2Fabc%3Fx%3D1");
    expect((await proxy(member("/ar/messages/abc"))).status).toBe(200);
    // The sign-in page renders without a session, the appeal page only with a mail's signed link.
    expect((await proxy(request("/fr/connexion"))).status).toBe(200);
    expect((await proxy(request(`/fr/recours?${APPEAL_TOKEN_PARAM}=abc.def`))).status).toBe(200);
    const appeals = await proxy(request("/fr/recours"));
    expect(appeals.status).toBe(307);
    expect(new URL(appeals.headers.get("location")!).pathname + new URL(appeals.headers.get("location")!).search).toBe("/fr/connexion?next=%2Ffr%2Frecours");
    expect((await proxy(member("/fr/recours"))).status).toBe(200);
  });

  it("sends the home page and other query-less ISR pages with a query string to the clean path (audit D-5)", async () => {
    for (const path of ["/fr", "/ar/aide/securite", "/fr/legal/cgu", "/rif/tarifs", "/fr/boutiques"]) {
      const response = await proxy(request(`${path}?x=${Math.random()}`));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(`https://joutiya.ma${path}`);
    }
    expect((await proxy(request("/fr/recherche?q=velo"))).status).toBe(200);
  });

  it("meters /annonce, /c, /profil and /boutique only", async () => {
    for (const path of ["/fr/annonce/velo-casablanca-abcd2345", "/ar/c/vehicules", "/rif/profil/abcdefghjk", "/fr/boutique/abcdefghjk"]) {
      checkPageLimits.mockClear();
      await proxy(request(path));
      expect(checkPageLimits, path).toHaveBeenCalledTimes(1);
    }
    for (const path of ["/fr", "/fr/recherche", "/fr/legal/cgu", "/fr/connexion", "/fr/anti-robot", "/api/listings"]) {
      checkPageLimits.mockClear();
      await proxy(request(path));
      expect(checkPageLimits, path).not.toHaveBeenCalled();
    }
  });

  it("sends a visitor over the limits without a pass to the challenge page, uncached", async () => {
    checkPageLimits.mockResolvedValueOnce({ kind: "challenge", retryAfterSeconds: 120 });
    const response = await proxy(request("/ar/annonce/velo-casablanca-abcd2345?ref=1"));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/ar/anti-robot");
    expect(location.searchParams.get("next")).toBe("/ar/annonce/velo-casablanca-abcd2345?ref=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 429 with Retry-After once the pass allowance is spent, and to non-GET requests", async () => {
    checkPageLimits.mockResolvedValueOnce({ kind: "limited", retryAfterSeconds: 300 });
    const limited = await proxy(request("/fr/profil/abcdefghjk"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("300");
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(limited.headers.get("content-type")).toContain("text/html");
    expect(limited.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await limited.text()).toContain('lang="fr"');
    checkPageLimits.mockResolvedValueOnce({ kind: "challenge", retryAfterSeconds: 60 });
    const post = await proxy(new NextRequest("https://joutiya.ma/fr/annonce/velo-casablanca-abcd2345", { method: "POST", headers: { host: "joutiya.ma" } }));
    expect(post.status).toBe(429);
    expect(post.headers.get("retry-after")).toBe("60");
  });

  it("lets verified bots through without counting them", async () => {
    const bot = new NextRequest("https://joutiya.ma/fr/annonce/velo-casablanca-abcd2345", { headers: { host: "joutiya.ma", "x-verified-bot": "1" } });
    const response = await proxy(bot);
    expect(response.status).toBe(200);
    expect(await checkPageLimits.mock.results.at(-1)?.value).toEqual({ kind: "allow" });
  });

  it("gives the search page a nonce CSP and a device cookie (dynamic page), keeping a valid one", async () => {
    const fresh = await proxy(request("/fr/recherche?q=velo"));
    // Only the device cookie: the locale cookie stays off shared pages.
    const cookies = fresh.headers.getSetCookie();
    expect(cookies.map((value) => value.split("=")[0])).toEqual(["__Host-did"]);
    expect(cookies[0]).toMatch(/^__Host-did=[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}; Path=\/; .*HttpOnly/);
    expect(cookies[0]).toContain("Secure");
    const value = /^__Host-did=([^;]+)/.exec(cookies[0] ?? "")?.[1];
    // Streamed per request: React's inline scripts need the nonce, not the hash of shared pages.
    expect(fresh.headers.get(INLINE_HASH_MARKER)).toBeNull();
    expect(fresh.headers.get("content-security-policy")).toMatch(/script-src[^;]*'nonce-/);
    // The public layout's theme script carries no nonce: its pinned hash is allowed.
    const [themeHash] = [...PINNED_SCRIPT_HASHES];
    expect(fresh.headers.get("content-security-policy")).toContain(`'sha256-${themeHash}'`);
    expect((await proxy(request("/fr/connexion"))).headers.get("content-security-policy")).not.toContain("'sha256-");
    const kept = await proxy(new NextRequest("https://joutiya.ma/fr/recherche", { headers: { host: "joutiya.ma", cookie: `__Host-did=${value}` } }));
    expect(kept.headers.get("set-cookie")).toBeNull();
    expect((await proxy(request("/fr/c/vehicules"))).headers.get("set-cookie")).toBeNull();
  });
});

describe("proxy before the opening (OPENS_AT)", () => {
  const SECRET = "a".repeat(20) + "B1".repeat(10);
  const HOST = "aalan.ma";
  const visitor = (path: string) => request(path, HOST);
  const signedIn = (path: string) => member(path, HOST);
  beforeEach(() => {
    vi.stubEnv("OPENS_AT", new Date(Date.now() + 86_400_000).toISOString());
    vi.stubEnv("ADMIN_HOST", `admin.${HOST}`);
  });

  it("renders the home page of each locale with the countdown page, as a shared page", async () => {
    for (const locale of ["fr", "ar", "rif"]) {
      const response = await proxy(visitor(`/${locale}`));
      expect(response.headers.get("x-middleware-rewrite")).toBe(`https://${HOST}/${locale}/ouverture`);
      expect(response.headers.get(INLINE_HASH_MARKER)).toBe("1");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("sends every other page to the home page, uncached, and keeps the legal texts and the guide", async () => {
    for (const path of ["/fr/annonce/velo-casablanca-abcd2345", "/ar/recherche", "/fr/connexion", "/fr/inscription", "/fr/deposer", "/rif/c/vehicules", "/fr/aide"]) {
      const response = await proxy(signedIn(path));
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toBe(`https://${HOST}/${path.split("/")[1]}`);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
    }
    for (const path of ["/fr/legal/mentions-legales", "/ar/demarches", "/fr/demarches/vehicule"]) {
      const open = await proxy(visitor(path));
      expect(open.status, path).toBe(200);
      expect(open.headers.get("x-middleware-rewrite"), path).toBeNull();
    }
  });

  it("closes the public API but health, config, CSP reports, the preview pass and the webhooks", async () => {
    const closed = await proxy(visitor("/api/auth/signup"));
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("no-store");
    expect(Number(closed.headers.get("retry-after"))).toBeGreaterThan(0);
    for (const path of ["/api/listings", "/api/search", "/api/auth/login", "/api/uploads/sign"]) expect((await proxy(visitor(path))).status, path).toBe(503);
    for (const path of ["/api/health", "/api/config", "/api/csp-report", "/api/preview", "/api/webhooks/stripe", "/api/webhooks/revenuecat", "/api/auth/logout"]) {
      expect((await proxy(visitor(path))).status, path).toBe(200);
    }
    // The back office keeps working on its own host.
    expect((await proxy(request("/api/admin/users", `admin.${HOST}`))).status).toBe(200);
  });

  it("lets a valid preview pass through, never a forged one", async () => {
    vi.stubEnv("PREVIEW_SECRET", SECRET);
    const { previewPass } = await import("@/lib/launch/preview");
    const pass = (path: string, value: string) => new NextRequest(`https://${HOST}${path}`, { headers: { host: HOST, cookie: `__Host-preview=${value}` } });
    expect((await proxy(pass("/fr", previewPass(SECRET)))).headers.get("x-middleware-rewrite")).toBeNull();
    expect((await proxy(pass("/fr/annonce/velo-casablanca-abcd2345", previewPass(SECRET)))).status).toBe(200);
    expect((await proxy(pass("/api/listings", previewPass(SECRET)))).status).toBe(200);
    expect((await proxy(pass("/fr/recherche", "forged"))).status).toBe(307);
    expect((await proxy(pass("/api/listings", previewPass("x".repeat(40))))).status).toBe(503);
  });

  it("opens at the instant, and the countdown page is never reached directly", async () => {
    vi.stubEnv("OPENS_AT", new Date(Date.now() - 1000).toISOString());
    expect((await proxy(visitor("/fr"))).headers.get("x-middleware-rewrite")).toBeNull();
    expect((await proxy(visitor("/fr/annonce/velo-casablanca-abcd2345"))).status).toBe(200);
    expect((await proxy(visitor("/api/listings"))).status).toBe(200);
    for (const path of ["/fr/ouverture", "/ar/ouverture"]) {
      const response = await proxy(visitor(path));
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toBe(`https://${HOST}/${path.split("/")[1]}`);
    }
  });
});
