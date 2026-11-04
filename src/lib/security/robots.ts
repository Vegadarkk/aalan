/**
 * X-Robots-Tag of a page (src/proxy.ts): the admin host and every environment but production stay
 * out of search engines; in production, Tarifit pages stay `noindex, follow` until
 * RIF_INDEXABLE=true (its native review is a launch gate, owner 19 Oct 2026; audit zone 2 L5).
 * Tarifit stays out of the hreflang cluster either way (HREFLANG_LOCALES). A header rather than a
 * meta tag: prerendered pages are shared by staging and production, the proxy reads the environment
 * on each request.
 */
export function robotsTag(host: "public" | "admin", pathname: string, env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  if (host === "admin" || env.APP_ENV !== "prod") return "noindex, nofollow";
  if (pathname.split("/")[1] === "rif" && env.RIF_INDEXABLE?.trim() !== "true") return "noindex, follow";
  return null;
}
