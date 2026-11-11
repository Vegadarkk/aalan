import { describe, expect, it } from "vitest";
import { closedDecision, invalidOpensAt, isClosed, parseOpensAt, timeLeft } from "@/lib/launch/gate";
import { hasPreviewPass, isPreviewKey, previewPass } from "@/lib/launch/preview";
import { brandSocialLinks } from "@/lib/launch/social";
import { parseEnv } from "@/lib/env";

const LOCALES = ["fr", "ar", "rif"];

describe("OPENS_AT", () => {
  it("takes an ISO date and time with its offset, nothing else", () => {
    expect(parseOpensAt("2026-11-20T10:00:00+01:00")?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(parseOpensAt("2026-11-20T09:00Z")?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    for (const value of ["2026-11-20", "2026-11-20T10:00:00", "20/11/2026 10:00", "2026-13-40T10:00:00Z", "demain"]) {
      expect(parseOpensAt(value), value).toBeNull();
      expect(invalidOpensAt(value), value).toBe(true);
    }
    expect(parseOpensAt(undefined)).toBeNull();
    expect(invalidOpensAt("")).toBe(false);
  });

  it("closes the site until the instant only", () => {
    const at = new Date("2026-11-20T09:00:00Z");
    expect(isClosed(at, new Date("2026-11-20T08:59:59Z"))).toBe(true);
    expect(isClosed(at, at)).toBe(false);
    expect(isClosed(null)).toBe(false);
  });

  it("is refused at startup when mistyped, with a short preview secret or a bad social link", () => {
    const errors = parseEnv({ OPENS_AT: "2026-11-20 10:00", PREVIEW_SECRET: "short", BRAND_SOCIAL_LINKS: "instagram=https://evil.example/aalan" }).errors.join("\n");
    expect(errors).toContain("OPENS_AT");
    expect(errors).toContain("PREVIEW_SECRET");
    expect(errors).toContain("BRAND_SOCIAL_LINKS: instagram: host");
    expect(parseEnv({ OPENS_AT: "2026-11-20T10:00:00+01:00", PREVIEW_SECRET: "A1".repeat(16), BRAND_SOCIAL_LINKS: "instagram=aalan.ma" }).errors).toEqual([]);
  });
});

describe("closedDecision", () => {
  it("renders the home with the countdown, keeps the legal texts and the guide, and sends the rest home", () => {
    expect(closedDecision("/ar", LOCALES, "fr")).toEqual({ kind: "closed-home", locale: "ar" });
    expect(closedDecision("/fr/", LOCALES, "fr")).toEqual({ kind: "closed-home", locale: "fr" });
    expect(closedDecision("/fr/legal/cgu", LOCALES, "fr")).toEqual({ kind: "pass" });
    expect(closedDecision("/ar/demarches", LOCALES, "fr")).toEqual({ kind: "pass" });
    expect(closedDecision("/fr/demarches/vehicule", LOCALES, "fr")).toEqual({ kind: "pass" });
    expect(closedDecision("/fr/demarchesx", LOCALES, "fr")).toEqual({ kind: "redirect-home", locale: "fr" });
    expect(closedDecision("/rif/annonce/x-abcd", LOCALES, "fr")).toEqual({ kind: "redirect-home", locale: "rif" });
    expect(closedDecision("/en/x", LOCALES, "fr")).toEqual({ kind: "redirect-home", locale: "fr" });
  });

  it("closes the API but its open list", () => {
    for (const path of ["/api/health", "/api/config", "/api/csp-report", "/api/preview", "/api/webhooks/stripe", "/api/auth/logout"]) expect(closedDecision(path, LOCALES, "fr"), path).toEqual({ kind: "pass" });
    for (const path of ["/api/auth/signup", "/api/listings", "/api/healthz", "/api/webhooks/stripe/x", "/api/configx"]) expect(closedDecision(path, LOCALES, "fr"), path).toEqual({ kind: "closed-api" });
  });
});

describe("timeLeft", () => {
  it("splits the time left and stops at zero", () => {
    const now = Date.UTC(2026, 10, 10, 9, 0, 0);
    expect(timeLeft(now + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 999, now)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5, total: 183_845 });
    expect(timeLeft(now - 5000, now)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });
  });
});

describe("preview pass", () => {
  const secret = "Z9".repeat(16);
  it("is an HMAC of the secret, checked in constant time, never without a usable secret", () => {
    expect(previewPass(secret)).not.toContain(secret);
    expect(hasPreviewPass(previewPass(secret), secret)).toBe(true);
    expect(hasPreviewPass(previewPass(secret), "Y8".repeat(16))).toBe(false);
    expect(hasPreviewPass(previewPass("short"), "short")).toBe(false);
    expect(hasPreviewPass(undefined, secret)).toBe(false);
    expect(isPreviewKey(secret, secret)).toBe(true);
    expect(isPreviewKey(`${secret}x`, secret)).toBe(false);
    expect(isPreviewKey(null, secret)).toBe(false);
  });
});

describe("BRAND_SOCIAL_LINKS", () => {
  it("keeps the order, rebuilds each link on the network's own profile page", () => {
    const { links, problems } = brandSocialLinks("tiktok=@aalan.ma, instagram=https://www.instagram.com/aalan.ma/ youtube=https://www.youtube.com/@aalan");
    expect(problems).toEqual([]);
    expect(links.map((link) => link.network)).toEqual(["tiktok", "instagram", "youtube"]);
    expect(links[1]?.href).toBe("https://www.instagram.com/aalan.ma/");
    for (const link of links) expect(link.href.startsWith("https://")).toBe(true);
  });

  it("reports what it cannot use", () => {
    expect(brandSocialLinks("myspace=aalan").problems).toHaveLength(1);
    expect(brandSocialLinks("instagram=a instagram=b").problems).toEqual(["instagram is listed twice"]);
    expect(brandSocialLinks("whatsapp=212612345678").problems).toEqual(["whatsapp: phone"]);
    expect(brandSocialLinks(undefined)).toEqual({ links: [], problems: [] });
  });
});
