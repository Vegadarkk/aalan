import { beforeEach, describe, expect, it, vi } from "vitest";

// Sign-in page after a suspension (synthesis §5, zone 7 P2-4): a cookie the server signed, revoked
// by the suspension, names the suspension and its end; anything else falls back to the generic notice.

const mocks = vi.hoisted(() => ({ verifySession: vi.fn(), getSuspension: vi.fn(), getClaims: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/claims", () => ({ getClaims: mocks.getClaims }));
vi.mock("@/lib/firebase/session", () => ({ verifySession: mocks.verifySession }));
vi.mock("@/lib/decisions/repository", () => ({ getSuspension: mocks.getSuspension }));
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn() } }));

const { claimsChange, endedSessionReason } = await import("@/lib/auth/ended-session");

const NOW = new Date("2026-11-04T12:00:00Z");
const UNTIL = new Date("2026-11-11T12:00:00Z");

describe("endedSessionReason", () => {
  beforeEach(() => {
    mocks.verifySession.mockReset().mockResolvedValue({ uid: "u1", claims: { role: "individual", v: 2 } });
    mocks.getSuspension.mockReset().mockResolvedValue({ until: UNTIL, decisionId: "d1", createdAt: NOW });
    mocks.getClaims.mockReset().mockResolvedValue({ role: "individual", v: 2 });
  });

  it("names a running suspension, checking the cookie without the revocation check", async () => {
    await expect(endedSessionReason("cookie", NOW)).resolves.toEqual({ kind: "suspended", until: UNTIL });
    expect(mocks.verifySession).toHaveBeenCalledWith("cookie", { checkRevoked: false });
    expect(mocks.getSuspension).toHaveBeenCalledWith("u1");
  });

  it("says nothing for a forged or expired cookie, no suspension, or one already over", async () => {
    mocks.verifySession.mockResolvedValueOnce(null);
    await expect(endedSessionReason("forged", NOW)).resolves.toBeNull();
    mocks.getSuspension.mockResolvedValueOnce(null);
    await expect(endedSessionReason("cookie", NOW)).resolves.toBeNull();
    mocks.getSuspension.mockResolvedValueOnce({ until: new Date("2026-11-04T11:00:00Z"), decisionId: "d1", createdAt: NOW });
    await expect(endedSessionReason("cookie", NOW)).resolves.toBeNull();
  });

  it("fails open when the suspension or the claims cannot be read", async () => {
    mocks.getSuspension.mockRejectedValueOnce(new Error("unavailable"));
    await expect(endedSessionReason("cookie", NOW)).resolves.toBeNull();
    mocks.getSuspension.mockResolvedValueOnce(null);
    mocks.getClaims.mockRejectedValueOnce(new Error("unavailable"));
    await expect(endedSessionReason("cookie", NOW)).resolves.toBeNull();
  });

  // Zone 7 audit P4: a shop's validation (or another rights change) revokes the sessions too.
  it("says the shop was validated when the account became Pro after the cookie was signed", async () => {
    mocks.getSuspension.mockResolvedValue(null);
    mocks.getClaims.mockResolvedValueOnce({ role: "pro", proId: "p1", proRole: "owner", v: 2 });
    await expect(endedSessionReason("cookie", NOW)).resolves.toEqual({ kind: "pro-validated" });
    expect(mocks.getClaims).toHaveBeenCalledWith("u1");
  });

  it("says the account changed for another rights change, and nothing when the rights are the same", async () => {
    mocks.getSuspension.mockResolvedValue(null);
    mocks.verifySession.mockResolvedValueOnce({ uid: "u1", claims: { role: "individual", st: "suspended", v: 2 } });
    await expect(endedSessionReason("cookie", NOW)).resolves.toEqual({ kind: "account-changed" });
    await expect(endedSessionReason("cookie", NOW)).resolves.toBeNull();
  });

  // Zone 7 audit P2-10: an admin withdrew the shop's validation, the Pro role left the account.
  it("says the shop's validation was withdrawn when the Pro role left the account", async () => {
    mocks.getSuspension.mockResolvedValue(null);
    mocks.verifySession.mockResolvedValueOnce({ uid: "u1", claims: { role: "pro", proId: "p1", proRole: "owner", v: 2 } });
    await expect(endedSessionReason("cookie", NOW)).resolves.toEqual({ kind: "pro-withdrawn" });
  });
});

describe("claimsChange", () => {
  it("compares the rights, not the claims version", () => {
    expect(claimsChange({ role: "individual" }, { role: "individual", v: 2 })).toBeNull();
    expect(claimsChange({ role: "individual" }, { role: "pro", proId: "p1", proRole: "owner" })).toEqual({ kind: "pro-validated" });
    expect(claimsChange({ role: "pro", proId: "p1", proRole: "owner" }, { role: "pro", proId: "p1", proRole: "editor" })).toEqual({ kind: "account-changed" });
    expect(claimsChange({ role: "individual", st: "suspended" }, { role: "individual" })).toEqual({ kind: "account-changed" });
    expect(claimsChange({ role: "pro", proId: "p1" }, { role: "individual" })).toEqual({ kind: "pro-withdrawn" });
    expect(claimsChange({ role: "pro", proId: "p1", st: "suspended" }, { role: "individual", st: "suspended" })).toEqual({ kind: "pro-withdrawn" });
  });
});
