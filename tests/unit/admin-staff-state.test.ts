import { describe, expect, it } from "vitest";
import { inviteExpiry, staffState, STAFF_INVITE_LINK_MINUTES } from "@/lib/auth/staff-state";

// Audit zone 7 P3-5: an invited member is pending until they set their password, and the roster
// shows when the invitation link expires.

const INVITED = "2026-11-04T10:00:00.000Z";

describe("staff roster state", () => {
  it("is pending after an invitation, with the link's expiry", () => {
    const state = staffState({ revokedAt: null, invitedAt: INVITED, activatedAt: null }, new Date("2026-11-04T10:30:00.000Z"));
    expect(state).toEqual({ kind: "pending", invitedAt: INVITED, expiresAt: "2026-11-04T11:00:00.000Z", expired: false });
    expect(STAFF_INVITE_LINK_MINUTES).toBe(60);
  });

  it("marks the link expired once the hour is over", () => {
    expect(staffState({ revokedAt: null, invitedAt: INVITED, activatedAt: null }, new Date("2026-11-04T11:00:00.000Z"))).toMatchObject({ kind: "pending", expired: true });
  });

  it("is active once accepted, and for entries older than the pending state", () => {
    expect(staffState({ revokedAt: null, invitedAt: INVITED, activatedAt: "2026-11-04T10:05:00.000Z" })).toEqual({ kind: "active" });
    expect(staffState({ revokedAt: null, invitedAt: null, activatedAt: null })).toEqual({ kind: "active" });
  });

  it("shows a revocation before anything else", () => {
    expect(staffState({ revokedAt: "2026-11-05T08:00:00.000Z", invitedAt: INVITED, activatedAt: null })).toEqual({ kind: "revoked", at: "2026-11-05T08:00:00.000Z" });
  });

  it("counts the expiry from a date or an ISO string", () => {
    expect(inviteExpiry(new Date(INVITED)).toISOString()).toBe("2026-11-04T11:00:00.000Z");
    expect(inviteExpiry(INVITED).toISOString()).toBe("2026-11-04T11:00:00.000Z");
  });
});
