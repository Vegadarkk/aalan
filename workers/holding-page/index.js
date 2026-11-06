// Holding page of aalan.ma until the production serves it (6 Nov 2026): the welcome door shut,
// "Bientôt", Aalan's social accounts and the publisher notice. Static files from site/ (build.mjs),
// uploaded as text and data modules by scripts/holding-page.ts; the route aalan.ma/* sends every
// request here before the tunnel. Removed by `scripts/holding-page.ts --remove` when the production
// serves aalan.ma (docs/lancement/page-attente.md).

import fr from "./site/fr.html";
import ar from "./site/ar.html";
import launchCss from "./site/launch.css";
import { FONTS, BINARIES } from "./manifest.js";

const ONE_HOUR = 3600;

const SECURITY = {
  "content-security-policy":
    "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
  // A placeholder: search engines wait for the real site.
  "x-robots-tag": "noindex, follow",
};

function respond(body, type, maxAge, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": type, "cache-control": `public, max-age=${maxAge}`, ...SECURITY, ...extra },
  });
}

const html = (body, status = 200) => respond(body, "text/html; charset=utf-8", 300, status);

const worker = {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD", ...SECURITY } });
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || path === "/fr" || path === "/rif") return html(fr);
    if (path === "/ar") return html(ar);
    if (path === "/hold/launch.css") return respond(launchCss, "text/css; charset=utf-8", ONE_HOUR);
    const font = /^\/hold\/fonts\/([\w.-]+\.woff2)$/.exec(path);
    if (font && FONTS[font[1]]) return respond(FONTS[font[1]], "font/woff2", 30 * 24 * ONE_HOUR);
    const binary = BINARIES[path];
    if (binary) return respond(binary.body, binary.type, 24 * ONE_HOUR);
    if (path === "/robots.txt") return respond("User-agent: *\nAllow: /\n", "text/plain; charset=utf-8", ONE_HOUR);
    if (path.startsWith("/hold/") || path.startsWith("/_next/") || path.startsWith("/api/") || path.startsWith("/.well-known/")) {
      return respond("Not Found", "text/plain; charset=utf-8", 60, 404);
    }
    // Any other page of the future site: the home page of its language.
    const target = path.startsWith("/ar") ? "/ar" : "/";
    return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store", ...SECURITY } });
  },
};

export default worker;
