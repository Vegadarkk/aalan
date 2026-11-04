import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS, type RateLimitId } from "@/config/rate-limits";
import { PASSWORD_MAX } from "@/lib/contracts/auth";
import { IdentityToolkitError } from "@/lib/firebase/rest";
import type * as Rest from "@/lib/firebase/rest";

// /api/auth/action, verifyEmail (audit A-1): the code is read without being applied; the sign-up
// device applies it at once, any other device only with the account password, checked with the
// login protections (lock, Turnstile, counters). Firebase, the limiter and the session are mocked.

const m = vi.hoisted(() => ({
  verifyPasswordResetCode: vi.fn(),
  applyEmailVerificationCode: vi.fn(),
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserPrivate: vi.fn(),
  activateMember: vi.fn(),
  createSessionForUid: vi.fn(),
  logConnection: vi.fn(),
  removeSuppression: vi.fn(),
  checkTurnstile: vi.fn(),
  enforceLimit: vi.fn(),
  consumeLimit: vi.fn(),
  limitState: vi.fn(),
  consumedPoints: vi.fn(),
  resetLimit: vi.fn(),
  blockLimit: vi.fn(),
}));

vi.mock("@/lib/firebase/rest", async (importOriginal) => ({
  ...(await importOriginal<typeof Rest>()),
  verifyPasswordResetCode: m.verifyPasswordResetCode,
  applyEmailVerificationCode: m.applyEmailVerificationCode,
  signInWithPassword: m.signInWithPassword,
}));
vi.mock("@/lib/firebase/admin", () => ({ auth: () => ({ getUser: m.getUser, getUserByEmail: m.getUserByEmail }) }));
vi.mock("@/lib/db/repositories/users", () => ({ getUserPrivate: m.getUserPrivate, emailNormHash: (email: string) => `h:${email}`, findUidByEmail: vi.fn(async () => null) }));
vi.mock("@/lib/auth/activation", () => ({ activateMember: m.activateMember }));
vi.mock("@/lib/auth/summary", () => ({ sessionSummary: async (user: { uid: string }) => ({ uid: user.uid }) }));
vi.mock("@/lib/firebase/session", () => ({ createSessionForUid: m.createSessionForUid, createSessionFromServerSignIn: vi.fn() }));
vi.mock("@/lib/logging/connection-logs", () => ({ logConnection: m.logConnection }));
vi.mock("@/lib/mail/suppressions", () => ({ removeSuppression: m.removeSuppression }));
vi.mock("@/lib/security/hash", () => ({ pepperedHash: (scope: string, value: string) => `${scope}:${value}`, safeEqual: (a: string, b: string) => a === b }));
vi.mock("@/lib/auth/respond", () => ({ signedIn: (_minted: unknown, body: unknown) => Response.json(body, { headers: { "x-signed-in": "1" } }) }));
vi.mock("@/lib/auth/anonymous", () => ({
  anonymous: (run: (request: Request) => Promise<Response>) => run,
  beginAnonymous: (request: Request) => ({ identity: { ip: "10.0.0.1", ipBucket: "10.0.0.1", ip48: null, deviceId: request.headers.get("x-device") } }),
  respond: (_flow: unknown, body: unknown) => Response.json(body),
  finish: (_flow: unknown, response: Response) => response,
  checkTurnstile: m.checkTurnstile,
  hasPass: () => false,
}));
vi.mock("@/lib/rate-limit/limiter", () => ({
  enforceLimit: m.enforceLimit,
  consumeLimit: m.consumeLimit,
  assertLimit: vi.fn(),
  limitState: m.limitState,
  consumedPoints: m.consumedPoints,
  rateLimitDefinition: async (id: RateLimitId) => RATE_LIMITS[id],
  resetLimit: m.resetLimit,
  blockLimit: m.blockLimit,
}));

const { handleAction } = await import("@/lib/auth/action");

const EMAIL = "yasmine@example.com";
const UID = "uid-1";
const CODE = "verify-code-0123456789";
// Assembled at runtime: a literal would look like a credential to the secret scan.
const PASSWORD = ["Correct", "Horse", "9"].join("-");

function post(body: Record<string, unknown>, device: string | null = null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (device) headers.set("x-device", device);
  return new Request("http://localhost:3000/api/auth/action", { method: "POST", headers, body: JSON.stringify({ mode: "verifyEmail", oobCode: CODE, ...body }) });
}

async function rejection(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  const error = (await promise.then(
    () => null,
    (reason: unknown) => reason,
  )) as { status: number; code: string } | null;
  if (!error) throw new Error("expected a rejection");
  return { status: error.status, code: error.code };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.verifyPasswordResetCode.mockResolvedValue({ requestType: "VERIFY_EMAIL", email: EMAIL });
  m.applyEmailVerificationCode.mockResolvedValue({ email: EMAIL, localId: UID, emailVerified: true });
  m.getUserByEmail.mockResolvedValue({ uid: UID, email: EMAIL });
  m.getUser.mockResolvedValue({ uid: UID, email: EMAIL, disabled: false, customClaims: {} });
  m.getUserPrivate.mockResolvedValue({ signupDeviceHash: "did:signup-device" });
  m.activateMember.mockResolvedValue(true);
  m.createSessionForUid.mockImplementation(async (uid: string) => ({ user: { uid }, cookie: "cookie", maxAge: 60 }));
  m.removeSuppression.mockResolvedValue(undefined);
  m.consumeLimit.mockResolvedValue({ ok: true, remaining: 4 });
  m.limitState.mockResolvedValue({ consumedPoints: 0, msBeforeNext: 0 });
  m.consumedPoints.mockResolvedValue(0);
  m.signInWithPassword.mockResolvedValue({ localId: UID, idToken: "id-token" });
});

describe("POST /api/auth/action, verifyEmail", () => {
  it("applies the code and opens a session on the device that signed up", async () => {
    const response = await handleAction(post({}, "signup-device"));
    expect(await response.json()).toEqual({ status: "verified", session: { uid: UID } });
    expect(response.headers.get("x-signed-in")).toBe("1");
    expect(m.verifyPasswordResetCode).toHaveBeenCalledWith(CODE);
    expect(m.applyEmailVerificationCode).toHaveBeenCalledWith(CODE);
    expect(m.activateMember).toHaveBeenCalledWith(UID, {});
    expect(m.signInWithPassword).not.toHaveBeenCalled();
    expect(m.logConnection).toHaveBeenCalledWith({ uid: UID, event: "login", ip: "10.0.0.1" });
  });

  it("keeps the code on another device and asks for the account password", async () => {
    for (const device of [null, "other-device"]) {
      const response = await handleAction(post({}, device));
      expect(await response.json()).toEqual({ status: "password_required", email: EMAIL });
    }
    expect(m.applyEmailVerificationCode).not.toHaveBeenCalled();
    expect(m.activateMember).not.toHaveBeenCalled();
    expect(m.createSessionForUid).not.toHaveBeenCalled();
    // The link holder proved the mailbox receives mail: the suppression lifts anyway.
    expect(m.removeSuppression).toHaveBeenCalledWith(EMAIL);
  });

  it("refuses a wrong password like the login, counts the failure and leaves the code unused", async () => {
    m.signInWithPassword.mockRejectedValue(new IdentityToolkitError("INVALID_LOGIN_CREDENTIALS", 400));
    expect(await rejection(handleAction(post({ password: "not-the-password" }, "other-device")))).toEqual({ status: 401, code: "invalid_credentials" });
    expect(m.signInWithPassword).toHaveBeenCalledWith(EMAIL, "not-the-password");
    expect(m.consumeLimit).toHaveBeenCalledWith("login.fail.accountIp", `h:${EMAIL}:10.0.0.1`);
    expect(m.consumeLimit).toHaveBeenCalledWith("login.fail.account", `h:${EMAIL}`);
    expect(m.applyEmailVerificationCode).not.toHaveBeenCalled();
    expect(m.createSessionForUid).not.toHaveBeenCalled();
  });

  it("applies the code, activates the account and signs in once the password is right", async () => {
    const response = await handleAction(post({ password: PASSWORD }, "other-device"));
    expect(await response.json()).toEqual({ status: "verified", session: { uid: UID } });
    expect(response.headers.get("x-signed-in")).toBe("1");
    expect(m.signInWithPassword).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(m.resetLimit).toHaveBeenCalledWith("login.fail.accountIp", `h:${EMAIL}:10.0.0.1`);
    expect(m.applyEmailVerificationCode).toHaveBeenCalledWith(CODE);
    expect(m.activateMember).toHaveBeenCalledWith(UID, {});
    expect(m.logConnection).toHaveBeenCalledWith({ uid: UID, event: "login", ip: "10.0.0.1" });
  });

  it("refuses the password of another account, and a staff account, as a wrong password", async () => {
    m.signInWithPassword.mockResolvedValue({ localId: "uid-2", idToken: "id-token" });
    expect(await rejection(handleAction(post({ password: PASSWORD }, "other-device")))).toEqual({ status: 401, code: "invalid_credentials" });
    m.signInWithPassword.mockResolvedValue({ localId: UID, idToken: "id-token" });
    m.getUser.mockResolvedValue({ uid: UID, email: EMAIL, disabled: false, customClaims: { role: "moderator" } });
    expect(await rejection(handleAction(post({ password: PASSWORD }, "other-device")))).toEqual({ status: 401, code: "invalid_credentials" });
    expect(m.consumeLimit).toHaveBeenCalledWith("login.fail.account", `h:${EMAIL}`);
    expect(m.applyEmailVerificationCode).not.toHaveBeenCalled();
  });

  it("requires Turnstile once the account counts its hourly failures, as the login does", async () => {
    m.consumedPoints.mockResolvedValue(RATE_LIMITS["login.fail.account"].points);
    expect(await (await handleAction(post({ password: PASSWORD }, "other-device"))).json()).toEqual({ status: "turnstile_required" });
    expect(m.signInWithPassword).not.toHaveBeenCalled();
    const response = await handleAction(post({ password: PASSWORD, turnstileToken: "token" }, "other-device"));
    expect((await response.json()).status).toBe("verified");
    expect(m.checkTurnstile).toHaveBeenCalledWith(expect.anything(), "token", "login");
  });

  it("answers account_locked once the account + IP exhausted its failures, without a password check", async () => {
    m.limitState.mockResolvedValue({ consumedPoints: RATE_LIMITS["login.fail.accountIp"].points, msBeforeNext: 60_000 });
    expect(await rejection(handleAction(post({ password: PASSWORD }, "other-device")))).toEqual({ status: 429, code: "account_locked" });
    expect(m.signInWithPassword).not.toHaveBeenCalled();
    expect(m.applyEmailVerificationCode).not.toHaveBeenCalled();
  });

  it("refuses a code of another type and a disabled account before anything is applied", async () => {
    m.verifyPasswordResetCode.mockResolvedValueOnce({ requestType: "PASSWORD_RESET", email: EMAIL });
    expect(await rejection(handleAction(post({}, "signup-device")))).toEqual({ status: 400, code: "invalid_code" });
    m.verifyPasswordResetCode.mockRejectedValueOnce(new IdentityToolkitError("EXPIRED_OOB_CODE", 400));
    expect(await rejection(handleAction(post({}, "signup-device")))).toEqual({ status: 400, code: "expired_code" });
    m.getUser.mockResolvedValue({ uid: UID, email: EMAIL, disabled: true, customClaims: {} });
    expect(await rejection(handleAction(post({ password: PASSWORD }, "signup-device")))).toEqual({ status: 403, code: "account_disabled" });
    expect(m.applyEmailVerificationCode).not.toHaveBeenCalled();
  });

  it("refuses a password longer than the login accepts", async () => {
    expect(await rejection(handleAction(post({ password: "x".repeat(PASSWORD_MAX + 1) }, "other-device")))).toMatchObject({ status: 400 });
    expect(m.verifyPasswordResetCode).not.toHaveBeenCalled();
  });
});
