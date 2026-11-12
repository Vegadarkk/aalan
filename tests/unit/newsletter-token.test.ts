import { beforeEach, describe, expect, it } from "vitest";
import { resetServerEnv } from "@/lib/env";
import { CONFIRM_TTL_MS, confirmToken, subscriberId, unsubscribeToken, verifyConfirmToken, verifyUnsubscribeToken } from "@/lib/newsletter/token";

// Opening list (owner, 2026-11-12): the confirmation link carries the address for 48 hours, the
// unsubscribe link names the subscriber's document for good; both are signed under HASH_PEPPER.

const NOW = Date.parse("2026-11-12T01:00:00Z");

beforeEach(() => {
  process.env.APP_ENV = "dev";
  delete process.env.HASH_PEPPER;
  resetServerEnv();
});

const tamper = (token: string) => `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

describe("confirmation token", () => {
  it("round-trips the address and the language until it expires", () => {
    const token = confirmToken("nadia.b+aalan@gmail.com", "ar", NOW);
    expect(verifyConfirmToken(token, NOW)).toEqual({ email: "nadia.b+aalan@gmail.com", lang: "ar", expiresAt: Math.floor((NOW + CONFIRM_TTL_MS) / 1000) * 1000 });
    expect(verifyConfirmToken(token, NOW + CONFIRM_TTL_MS - 1_000)).not.toBeNull();
    expect(verifyConfirmToken(token, NOW + CONFIRM_TTL_MS + 1_000)).toBeNull();
  });

  it("refuses an altered, truncated, re-signed or unsubscribe token", () => {
    const token = confirmToken("nadia@example.com", "fr", NOW);
    expect(verifyConfirmToken(tamper(token), NOW)).toBeNull();
    expect(verifyConfirmToken(token.slice(0, 20), NOW)).toBeNull();
    expect(verifyConfirmToken(`${token}.x`, NOW)).toBeNull();
    expect(verifyConfirmToken(unsubscribeToken("nadia@example.com"), NOW)).toBeNull();
    // Another address under the same signature.
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(`c1.${Buffer.from("eve@example.com").toString("base64url")}.fr.${Math.floor(NOW / 1000) + 3600}`).toString("base64url")}.${sig}`;
    expect(verifyConfirmToken(forged, NOW)).toBeNull();
    process.env.HASH_PEPPER = "another-pepper-of-at-least-32-characters!!";
    resetServerEnv();
    expect(verifyConfirmToken(token, NOW)).toBeNull();
  });
});

describe("unsubscribe token", () => {
  it("names one document per person, whatever the Gmail dots or +tag", () => {
    expect(subscriberId("Nadia.B+promo@gmail.com")).toBe(subscriberId("nadiab@googlemail.com"));
    expect(verifyUnsubscribeToken(unsubscribeToken("nadia.b@gmail.com"))).toBe(subscriberId("nadiab@gmail.com"));
  });

  it("refuses an altered token and a confirmation token", () => {
    const token = unsubscribeToken("nadia@example.com");
    expect(verifyUnsubscribeToken(tamper(token))).toBeNull();
    expect(verifyUnsubscribeToken(confirmToken("nadia@example.com", "fr", NOW))).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
  });
});
