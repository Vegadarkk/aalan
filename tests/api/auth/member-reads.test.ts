import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Quota from "@/lib/quota";

// Reads of a member's own account (Firebase emulators): the session summary, the settings reads,
// the decisions, upload status and « Mes avis » share one daily document budget per account
// (member.docs.uid). Past it, or with Firestore reads degraded, GET /api/auth/me answers from the
// cookie alone and the other reads are refused, before any Firestore read. The password change has
// a daily cap and queues one security notice per account and hour.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", async (importOriginal) => ({ ...(await importOriginal<typeof Quota>()), firstDegraded: vi.fn(async () => null) }));
vi.mock("@/lib/db/repositories/users", { spy: true });

import { GET as reviewsRoute } from "@/app/api/account/reviews/route";
import { GET as tutorialsRoute } from "@/app/api/account/tutorials/route";
import { GET as appealsRoute } from "@/app/api/appeals/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as passwordChangeRoute } from "@/app/api/auth/password/change/route";
import { GET as uploadStatusRoute } from "@/app/api/uploads/[id]/route";
import type { MeResponse } from "@/lib/contracts/auth";
import { getUser, getUserPrivate } from "@/lib/db/repositories/users";
import { sendMail } from "@/lib/mail";
import { firstDegraded } from "@/lib/quota";
import { QUOTA_ERROR_CODE } from "@/lib/quota/gate";
import { consumeLimit, consumedPoints, resetRateLimiters } from "@/lib/rate-limit/limiter";
import { api, member, type ErrorBody } from "../listings/helpers";

const MEMBER_PASSWORD = ["Str0ng", "Passw0rd!"].join("-");

beforeEach(() => {
  resetRateLimiters();
  vi.mocked(firstDegraded).mockReset();
  vi.mocked(firstDegraded).mockResolvedValue(null);
  vi.mocked(sendMail).mockClear();
});

async function spendDay(uid: string): Promise<void> {
  await consumeLimit("member.docs.uid", uid, 5000);
}

describe("GET /api/auth/me", () => {
  it("charges the summary's two documents, then answers from the cookie once the day is spent", async () => {
    const who = await member({ displayName: "Imane Lectrice" });
    const first = await api<MeResponse>(meRoute, "GET", "/api/auth/me", { member: who });
    expect(first.status).toBe(200);
    expect(first.body.session).toMatchObject({ uid: who.uid, displayName: "Imane Lectrice", providers: ["password"] });
    expect(await consumedPoints("member.docs.uid", who.uid)).toBe(2);
    expect(await consumedPoints("member.read.uid", who.uid)).toBe(1);

    await spendDay(who.uid);
    vi.mocked(getUser).mockClear();
    vi.mocked(getUserPrivate).mockClear();
    const spent = await api<MeResponse>(meRoute, "GET", "/api/auth/me", { member: who });
    expect(spent.status).toBe(200);
    expect(spent.body.session).toMatchObject({ uid: who.uid, email: who.email, emailVerified: true, role: "individual", displayName: null, cguUpdate: null });
    expect(spent.header("x-csrf-token")).toBeTruthy();
    expect(getUser).not.toHaveBeenCalled();
    expect(getUserPrivate).not.toHaveBeenCalled();
  });

  it("answers from the cookie while Firestore reads are degraded", async () => {
    const who = await member();
    vi.mocked(firstDegraded).mockResolvedValue("firestore.reads");
    vi.mocked(getUser).mockClear();
    const degraded = await api<MeResponse>(meRoute, "GET", "/api/auth/me", { member: who });
    expect(degraded.status).toBe(200);
    expect(degraded.body.session).toMatchObject({ uid: who.uid, displayName: null });
    expect(getUser).not.toHaveBeenCalled();
    expect(firstDegraded).toHaveBeenCalledWith(["firestore.reads"]);
  });

  it("still answers null without a session, charging nothing", async () => {
    const anonymous = await api<MeResponse>(meRoute, "GET", "/api/auth/me");
    expect(anonymous.body.session).toBeNull();
  });
});

describe("settings and decisions reads", () => {
  it("charge the budget, refuse with 429 once it is spent, and 503 while reads are degraded", async () => {
    const who = await member();
    expect((await api(tutorialsRoute, "GET", "/api/account/tutorials", { member: who })).status).toBe(200);
    expect((await api(appealsRoute, "GET", "/api/appeals", { member: who })).status).toBe(200);
    expect(await consumedPoints("member.docs.uid", who.uid)).toBe(2);

    vi.mocked(firstDegraded).mockResolvedValue("firestore.reads");
    const degraded = await api<ErrorBody>(tutorialsRoute, "GET", "/api/account/tutorials", { member: who });
    expect([degraded.status, degraded.body.error.code]).toEqual([503, QUOTA_ERROR_CODE]);
    vi.mocked(firstDegraded).mockResolvedValue(null);

    await spendDay(who.uid);
    for (const [route, path] of [
      [tutorialsRoute, "/api/account/tutorials"],
      [appealsRoute, "/api/appeals"],
    ] as const) {
      const refused = await api<ErrorBody>(route, "GET", path, { member: who });
      expect([refused.status, refused.body.error.code], path).toEqual([429, "rate_limited"]);
    }
  });

  it("share the day with upload status and « Mes avis », whose hourly limiters stay", async () => {
    const who = await member();
    expect((await api(reviewsRoute, "GET", "/api/account/reviews?sens=recus", { member: who })).status).toBe(200);
    expect(await consumedPoints("member.docs.uid", who.uid)).toBe(1);
    await spendDay(who.uid);
    expect((await api(reviewsRoute, "GET", "/api/account/reviews", { member: who })).status).toBe(429);
    expect((await api(uploadStatusRoute, "GET", "/api/uploads/u0000000000000000001", { member: who, params: { id: "u0000000000000000001" } })).status).toBe(429);
  });
});

describe("password change", () => {
  it("queues one notice per account and hour, and stops at the daily cap", async () => {
    const who = await member();
    const changed = await api(passwordChangeRoute, "POST", "/api/auth/password/change", { member: who, body: { currentPassword: MEMBER_PASSWORD, password: "Nouveau-Mot-2026!x" } });
    expect(changed.status).toBe(200);
    const notice = vi.mocked(sendMail).mock.calls.map(([mail]) => mail).find((mail) => mail.template === "passwordChanged");
    expect(notice?.idempotencyKey).toMatch(new RegExp(`^password-changed-${who.uid}-\\d+$`));

    await consumeLimit("password.change.day.uid", who.uid, 9);
    const capped = await api<ErrorBody>(passwordChangeRoute, "POST", "/api/auth/password/change", { member: who, body: { currentPassword: "Nouveau-Mot-2026!x", password: "Encore-Autre-2026!y" } });
    expect([capped.status, capped.body.error.code]).toEqual([429, "rate_limited"]);
  });
});
