import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Quota from "@/lib/quota";

// Writes a member causes on their own account (Firebase emulators): successful sign-ins are counted
// per account before the session and its connection log; the settings routes have a daily cap
// beside the hourly one, stop with the write gate, and write nothing when nothing changes.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", async (importOriginal) => ({ ...(await importOriginal<typeof Quota>()), firstDegraded: vi.fn(async () => null) }));
vi.mock("@/lib/db/repositories/users", { spy: true });
vi.mock("@/lib/logging/connection-logs", { spy: true });
vi.mock("@/lib/audit", { spy: true });
vi.mock("@/lib/listings/revalidate", { spy: true });

import { DELETE as emailCancelRoute } from "@/app/api/account/email/route";
import { POST as storefrontRoute } from "@/app/api/account/storefront/route";
import { POST as consentsRoute } from "@/app/api/auth/consents/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as profileRoute } from "@/app/api/auth/profile/route";
import { audit } from "@/lib/audit";
import { CGU_VERSION } from "@/lib/contracts/auth";
import { COLLECTIONS } from "@/lib/db/schemas";
import { getUserPrivate, setEmailChange, updateCguConsent, updateDisplayName, updateStorefront } from "@/lib/db/repositories/users";
import { db } from "@/lib/firebase/admin";
import { revalidateListingPaths } from "@/lib/listings/revalidate";
import { logConnection } from "@/lib/logging/connection-logs";
import { firstDegraded } from "@/lib/quota";
import { QUOTA_ERROR_CODE } from "@/lib/quota/gate";
import { consumeLimit, resetRateLimiters } from "@/lib/rate-limit/limiter";
import { api, member, type ErrorBody } from "../listings/helpers";
import { Jar, call } from "./helpers";

const MEMBER_PASSWORD = ["Str0ng", "Passw0rd!"].join("-");

beforeEach(() => {
  resetRateLimiters();
  vi.mocked(firstDegraded).mockReset();
  vi.mocked(firstDegraded).mockResolvedValue(null);
  vi.clearAllMocks();
});

describe("sign-ins per account", () => {
  it("refuses a proven sign-in past the account's hour or day, before the session and its log", async () => {
    const who = await member();
    const first = await call(loginRoute, "/api/auth/login", { jar: new Jar(), body: { email: who.email, password: MEMBER_PASSWORD } });
    expect(first.status).toBe(200);
    expect(logConnection).toHaveBeenCalledTimes(1);

    await consumeLimit("login.success.uid", who.uid, 29);
    const hourly = await call<ErrorBody>(loginRoute, "/api/auth/login", { jar: new Jar(), body: { email: who.email, password: MEMBER_PASSWORD } });
    expect([hourly.status, hourly.body.error.code]).toEqual([429, "rate_limited"]);
    expect(hourly.header("set-cookie") ?? "").not.toContain("__Host-session=");
    expect(logConnection).toHaveBeenCalledTimes(1);

    resetRateLimiters();
    await consumeLimit("login.success.day.uid", who.uid, 100);
    const daily = await call<ErrorBody>(loginRoute, "/api/auth/login", { jar: new Jar(), body: { email: who.email, password: MEMBER_PASSWORD } });
    expect(daily.status).toBe(429);
    expect(logConnection).toHaveBeenCalledTimes(1);
  });
});

describe("settings writes", () => {
  it("write a profile value only when it changes", async () => {
    const who = await member({ displayName: "Karim Réglages" });
    for (let i = 0; i < 2; i += 1) expect((await api(profileRoute, "POST", "/api/auth/profile", { member: who, body: { displayName: "Karim Nouveau" } })).status).toBe(200);
    expect(updateDisplayName).toHaveBeenCalledTimes(1);
  });

  it("leave an unchanged storefront and its pages alone", async () => {
    const who = await member();
    const body = { bio: "Vélos révisés à Casablanca.", citySlug: "casablanca" };
    for (let i = 0; i < 2; i += 1) expect((await api(storefrontRoute, "POST", "/api/account/storefront", { member: who, body })).status).toBe(200);
    expect(updateStorefront).toHaveBeenCalledTimes(1);
    expect(revalidateListingPaths).toHaveBeenCalledTimes(1);
  });

  it("record the CGU acceptance and its audit entry once per version", async () => {
    const who = await member();
    await db().collection(COLLECTIONS.users).doc(who.uid).collection("private").doc("account").update({ "consents.cgu.version": "2000-01" });
    for (let i = 0; i < 2; i += 1) expect((await api(consentsRoute, "POST", "/api/auth/consents", { member: who, body: { cgu: true } })).status).toBe(200);
    expect(updateCguConsent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls.filter(([entry]) => entry.action === "consent.cgu")).toHaveLength(1);
    expect((await getUserPrivate(who.uid))?.consents.cgu.version).toBe(CGU_VERSION);
  });

  it("cancel no address change when none is pending", async () => {
    const who = await member();
    expect((await api(emailCancelRoute, "DELETE", "/api/account/email", { member: who })).status).toBe(200);
    expect(setEmailChange).not.toHaveBeenCalled();
  });

  it("stop at the daily cap of each family, and with Firestore writes degraded", async () => {
    const who = await member();
    await consumeLimit("account.mutation.day.uid", who.uid, 100);
    const daily = await api<ErrorBody>(profileRoute, "POST", "/api/auth/profile", { member: who, body: { locale: "ar" } });
    expect([daily.status, daily.body.error.code]).toEqual([429, "rate_limited"]);
    await consumeLimit("consents.day.uid", who.uid, 10);
    expect((await api(consentsRoute, "POST", "/api/auth/consents", { member: who, body: { cgu: true } })).status).toBe(429);

    resetRateLimiters();
    vi.mocked(firstDegraded).mockResolvedValue("firestore.writes");
    const degraded = await api<ErrorBody>(profileRoute, "POST", "/api/auth/profile", { member: who, body: { locale: "ar" } });
    expect([degraded.status, degraded.body.error.code]).toEqual([503, QUOTA_ERROR_CODE]);
    expect(firstDegraded).toHaveBeenCalledWith(["firestore.writes"]);
  });
});
