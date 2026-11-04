import { describe, expect, it } from "vitest";
import { confirmVerdict, livePendingChange, maskEmail, pendingEmailChange } from "@/lib/account/email-change-rules";
import { EMAIL_CHANGE_TTL_HOURS, emailChangeSchema } from "@/lib/contracts/account";

// Change of e-mail address (audit Z1-10): the pending change, the link's verdict and the masked
// address of the notice. Pure; tests/api/account/email-change.test.ts runs the flow on the emulators.

const NOW = new Date("2026-11-04T10:00:00Z");
const HOUR = 3_600_000;

describe("pending change", () => {
  it("expires after the link's lifetime", () => {
    const pending = pendingEmailChange("new@example.com", NOW);
    expect(pending.expiresAt.getTime() - NOW.getTime()).toBe(EMAIL_CHANGE_TTL_HOURS * HOUR);
    expect(livePendingChange(pending, new Date(NOW.getTime() + HOUR))).toBe(pending);
    expect(livePendingChange(pending, pending.expiresAt)).toBeNull();
    expect(livePendingChange(undefined, NOW)).toBeNull();
  });
});

describe("confirmation link verdict", () => {
  const pending = pendingEmailChange("new@example.com", NOW);
  const code = { requestType: "VERIFY_AND_CHANGE_EMAIL", newEmail: "New@Example.com" };

  it("accepts the code of the change waiting for it", () => {
    expect(confirmVerdict(code, pending, new Date(NOW.getTime() + HOUR))).toEqual({ ok: true });
  });

  it("refuses another code type, another address, a cancelled request", () => {
    expect(confirmVerdict({ ...code, requestType: "VERIFY_EMAIL" }, pending, NOW)).toEqual({ ok: false, code: "invalid_code" });
    expect(confirmVerdict({ ...code, newEmail: "other@example.com" }, pending, NOW)).toEqual({ ok: false, code: "invalid_code" });
    expect(confirmVerdict({ requestType: "VERIFY_AND_CHANGE_EMAIL" }, pending, NOW)).toEqual({ ok: false, code: "invalid_code" });
    expect(confirmVerdict(code, undefined, NOW)).toEqual({ ok: false, code: "invalid_code" });
  });

  it("says a link past its 24 hours expired", () => {
    expect(confirmVerdict(code, pending, pending.expiresAt)).toEqual({ ok: false, code: "expired_code" });
  });
});

describe("masked address of the notice", () => {
  it("keeps the first character and the domain only", () => {
    expect(maskEmail("nadia.bennani@gmail.com")).toBe("n•••••@gmail.com");
    expect(maskEmail("é@exemple.ma")).toBe("é•••••@exemple.ma");
    expect(maskEmail("broken")).toBe("•••");
  });
});

describe("request body", () => {
  it("normalizes the new address and needs the current password", () => {
    expect(emailChangeSchema.parse({ newEmail: "  Nadia@Example.COM ", currentPassword: "x" })).toEqual({ newEmail: "nadia@example.com", currentPassword: "x" });
    expect(emailChangeSchema.safeParse({ newEmail: "nadia@example.com", currentPassword: "" }).success).toBe(false);
    expect(emailChangeSchema.safeParse({ newEmail: "not-an-address", currentPassword: "x" }).success).toBe(false);
    expect(emailChangeSchema.safeParse({ newEmail: "nadia@example.com", currentPassword: "x", uid: "other" }).success).toBe(false);
  });
});
