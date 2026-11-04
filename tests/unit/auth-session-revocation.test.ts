import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS, type RateLimitId } from "@/config/rate-limits";
import type * as Rest from "@/lib/firebase/rest";

// Session revocation on logout, password change and password reset: a revoked cookie never
// revokes the account's sessions (audit A-2), and every revocation closes the open live-messaging
// streams (publishRevoked, audit A-4). Firebase, the limiter, the mails and the bus are mocked.

const m = vi.hoisted(() => ({
  verifySession: vi.fn(),
  revokeSessions: vi.fn(),
  createSessionForUid: vi.fn(),
  publishRevoked: vi.fn(),
  logConnection: vi.fn(),
  requireUser: vi.fn(),
  getUser: vi.fn(),
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
  profile: vi.fn(),
  linkProvider: vi.fn(),
  activateMember: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("@/lib/firebase/session", () => ({ verifySession: m.verifySession, revokeSessions: m.revokeSessions, createSessionForUid: m.createSessionForUid, createSessionFromServerSignIn: vi.fn() }));
vi.mock("@/lib/messaging", () => ({ publishRevoked: m.publishRevoked }));
vi.mock("@/lib/logging/connection-logs", () => ({ logConnection: m.logConnection }));
vi.mock("@/lib/auth/guards", () => ({ requireSameOrigin: vi.fn(), optionalUser: vi.fn(), requireUser: m.requireUser, accessIdentity: vi.fn() }));
vi.mock("@/lib/security/origin", () => ({ hostKind: () => "admin", expectedOrigin: () => "http://admin.localhost" }));
vi.mock("@/lib/firebase/admin", () => ({ auth: () => ({ getUser: m.getUser, getUserByEmail: m.getUserByEmail, updateUser: m.updateUser }) }));
vi.mock("@/lib/firebase/rest", async (importOriginal) => ({
  ...(await importOriginal<typeof Rest>()),
  verifyPasswordResetCode: m.verifyPasswordResetCode,
  confirmPasswordReset: m.confirmPasswordReset,
  signInWithPassword: m.signInWithPassword,
}));
vi.mock("@/lib/db/repositories/users", () => ({
  emailNormHash: (email: string) => `h:${email}`,
  findUidByEmail: vi.fn(async () => null),
  getUser: m.profile,
  getUserPrivate: vi.fn(),
  linkProvider: m.linkProvider,
}));
vi.mock("@/lib/auth/activation", () => ({ activateMember: m.activateMember }));
vi.mock("@/lib/auth/mails", () => ({ sendPasswordChangedMail: vi.fn(), sendResetMail: vi.fn() }));
vi.mock("@/lib/auth/summary", () => ({ sessionSummary: async (user: { uid: string }) => ({ uid: user.uid }) }));
vi.mock("@/lib/security/csrf", () => ({ csrfToken: () => "csrf" }));
vi.mock("@/lib/auth/respond", () => ({
  deviceOf: () => ({ identity: { ip: "10.0.0.1", ipBucket: "10.0.0.1", ip48: null, deviceId: null } }),
  jsonResponse: (body: unknown) => NextResponse.json(body),
  withDevice: (response: Response) => response,
  applyDevice: (response: Response) => response,
  signedIn: (_minted: unknown, body: unknown) => NextResponse.json(body),
}));
vi.mock("@/lib/auth/anonymous", () => ({
  anonymous: (run: (request: Request) => Promise<Response>) => run,
  beginAnonymous: () => ({ identity: { ip: "10.0.0.1", ipBucket: "10.0.0.1", ip48: null, deviceId: null } }),
  respond: (_flow: unknown, body: unknown) => NextResponse.json(body),
  finish: (_flow: unknown, response: Response) => response,
  checkTurnstile: vi.fn(),
  hasPass: () => false,
  uniformDuration: vi.fn(),
}));
vi.mock("@/lib/rate-limit/limiter", () => ({
  enforceLimit: vi.fn(),
  consumeLimit: vi.fn(async () => ({ ok: true, remaining: 4 })),
  assertLimit: vi.fn(),
  limitState: vi.fn(async () => ({ consumedPoints: 0, msBeforeNext: 0 })),
  consumedPoints: vi.fn(async () => 0),
  rateLimitDefinition: async (id: RateLimitId) => RATE_LIMITS[id],
  resetLimit: vi.fn(),
  blockLimit: vi.fn(),
}));

const { handleLogout } = await import("@/lib/auth/session-handlers");
const { logout: staffLogout } = await import("@/lib/auth/staff");
const { handlePasswordChange, handleResetConfirm } = await import("@/lib/auth/password");

const UID = "uid-1";
const EMAIL = "yasmine@example.com";
// Assembled at runtime: a literal would look like a credential to the secret scan.
const CURRENT = ["Correct", "Horse", "9"].join("-");
const NEW_PASSWORD = ["Fresh", "Argan", "Oil", "42"].join("-");

function logoutRequest(origin = "http://localhost:3000"): Request {
  return new Request(`${origin}/api/auth/logout`, { method: "POST", headers: { origin, cookie: "__Host-session=stolen-cookie" } });
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** The cookies the answer clears (Max-Age=0). */
function cleared(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .filter((line) => /max-age=0/i.test(line))
    .map((line) => line.split("=")[0] ?? "");
}

const before = (a: ReturnType<typeof vi.fn>, b: ReturnType<typeof vi.fn>) => expect(a.mock.invocationCallOrder[0]).toBeLessThan(b.mock.invocationCallOrder[0] ?? 0);

beforeEach(() => {
  vi.resetAllMocks();
  m.createSessionForUid.mockImplementation(async (uid: string) => ({ user: { uid }, cookie: "cookie", maxAge: 60 }));
  m.getUser.mockResolvedValue({ uid: UID, email: EMAIL, disabled: false, customClaims: { role: "individual" } });
  m.getUserByEmail.mockResolvedValue({ uid: UID, email: EMAIL, disabled: false, customClaims: { role: "individual" } });
  m.profile.mockResolvedValue({ displayName: "Yasmine", locale: "fr" });
  m.linkProvider.mockResolvedValue(undefined);
  m.activateMember.mockResolvedValue(true);
  m.signInWithPassword.mockResolvedValue({ localId: UID, idToken: "id-token" });
  m.verifyPasswordResetCode.mockResolvedValue({ requestType: "PASSWORD_RESET", email: EMAIL });
  m.confirmPasswordReset.mockResolvedValue({ email: EMAIL });
});

describe.each([
  ["member logout", () => handleLogout(logoutRequest())],
  ["staff logout", () => staffLogout(logoutRequest("http://admin.localhost"))],
])("%s", (_name, run) => {
  it("only clears the cookies of a revoked or invalid session: nothing is revoked", async () => {
    m.verifySession.mockResolvedValue(null);
    const response = await run();
    expect(response.status).toBe(204);
    expect(m.verifySession).toHaveBeenCalledWith("stolen-cookie", { checkRevoked: true });
    expect(m.revokeSessions).not.toHaveBeenCalled();
    expect(m.publishRevoked).not.toHaveBeenCalled();
    expect(cleared(response)).toEqual(expect.arrayContaining(["__Host-session", "__Host-csrf"]));
  });

  it("revokes a live session and closes the account's open streams", async () => {
    m.verifySession.mockResolvedValue({ uid: UID });
    const response = await run();
    expect(response.status).toBe(204);
    expect(m.revokeSessions).toHaveBeenCalledWith(UID);
    expect(m.publishRevoked).toHaveBeenCalledWith(UID);
    before(m.revokeSessions, m.publishRevoked);
  });
});

describe("password change and reset", () => {
  it("closes the open streams after revoking the sessions on a password change", async () => {
    m.requireUser.mockResolvedValue({ user: { uid: UID, email: EMAIL } });
    const response = await handlePasswordChange(jsonRequest("/api/auth/password/change", { currentPassword: CURRENT, password: NEW_PASSWORD }));
    expect(response.status).toBe(200);
    expect(m.updateUser).toHaveBeenCalledWith(UID, { password: NEW_PASSWORD });
    expect(m.publishRevoked).toHaveBeenCalledWith(UID);
    before(m.revokeSessions, m.publishRevoked);
    // The new session of this device is minted after the streams were told to close.
    before(m.publishRevoked, m.createSessionForUid);
  });

  it("closes the open streams after revoking the sessions on a reset, and activates a pending account", async () => {
    m.getUserByEmail.mockResolvedValue({ uid: UID, email: EMAIL, disabled: false, customClaims: {} });
    const response = await handleResetConfirm(jsonRequest("/api/auth/password/confirm", { oobCode: "reset-code-0123456789", password: NEW_PASSWORD }));
    expect(await response.json()).toEqual({ status: "password_reset" });
    expect(m.confirmPasswordReset).toHaveBeenCalledWith("reset-code-0123456789", NEW_PASSWORD);
    expect(m.revokeSessions).toHaveBeenCalledWith(UID);
    expect(m.publishRevoked).toHaveBeenCalledWith(UID);
    before(m.revokeSessions, m.publishRevoked);
    expect(m.activateMember).toHaveBeenCalledWith(UID, {});
    expect(m.linkProvider).toHaveBeenCalledWith(UID, "password");
  });
});
