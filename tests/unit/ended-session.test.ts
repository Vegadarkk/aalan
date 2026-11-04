import { beforeEach, describe, expect, it, vi } from "vitest";

// Sign-in page after a suspension (synthesis §5, zone 7 P2-4): a cookie the server signed, revoked
// by the suspension, names the suspension and its end; anything else falls back to the generic notice.

const mocks = vi.hoisted(() => ({ verifySession: vi.fn(), getSuspension: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/session", () => ({ verifySession: mocks.verifySession }));
vi.mock("@/lib/decisions/repository", () => ({ getSuspension: mocks.getSuspension }));
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn() } }));

const { endedSessionReason } = await import("@/lib/auth/ended-session");

const NOW = new Date("2026-11-04T12:00:00Z");
const UNTIL = new Date("2026-11-11T12:00:00Z");

describe("endedSessionReason", () => {
  beforeEach(() => {
    mocks.verifySession.mockReset().mockResolvedValue({ uid: "u1" });
    mocks.getSuspension.mockReset().mockResolvedValue({ until: UNTIL, decisionId: "d1", createdAt: NOW });
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

  it("fails open when the suspension cannot be read", async () => {
    mocks.getSuspension.mockRejectedValueOnce(new Error("unavailable"));
    await expect(endedSessionReason("cookie", NOW)).resolves.toBeNull();
  });
});
