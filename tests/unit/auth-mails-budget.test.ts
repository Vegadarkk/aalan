import { beforeEach, describe, expect, it, vi } from "vitest";

// Mail caused by a request without a session runs on its own daily budget (mail.anonymous.daily):
// counted at enqueue, skipped once spent; members' mail never counts on it.

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", () => ({ consume: vi.fn() }));
vi.mock("@/lib/auth/links", () => ({ actionLinkRequest: vi.fn(() => ({ mode: "x" })), changeEmailLinkRequest: vi.fn(), pageUrl: vi.fn(() => "https://aalan.test/fr") }));
vi.mock("@/lib/security/hash", () => ({ pepperedHash: vi.fn(() => "hash") }));

const { sendMail } = await import("@/lib/mail");
const { consume } = await import("@/lib/quota");
const { sendPasswordChangedMail, sendResetMail, sendSignupExistingMail, sendVerificationMail } = await import("@/lib/auth/mails");

const recipient = { uid: "u1", email: "nadia@example.com", displayName: "Nadia", locale: "fr" as const };
const budget = (used: number, level = "ok") => vi.mocked(consume).mockResolvedValue({ id: "mail.anonymous.daily", period: "2026-11-16", used, limit: 150, ratio: used / 150, level } as never);

beforeEach(() => {
  vi.mocked(sendMail).mockClear();
  vi.mocked(consume).mockReset();
});

describe("anonymous mail budget", () => {
  it("counts sign-up, warning and never-verified reset mails, and flags them anonymous", async () => {
    budget(10);
    await sendVerificationMail(recipient);
    await sendSignupExistingMail(recipient);
    await sendResetMail({ ...recipient, verified: false });
    expect(consume).toHaveBeenCalledTimes(3);
    expect(consume).toHaveBeenCalledWith("mail.anonymous.daily");
    expect(vi.mocked(sendMail).mock.calls.map(([mail]) => [mail.template, mail.anonymous])).toEqual([
      ["verifyEmail", true],
      ["signupExisting", true],
      ["resetPassword", true],
    ]);
  });

  it("skips them once the budget is spent, and sends while the counter is unreadable", async () => {
    budget(151, "degraded");
    await sendVerificationMail(recipient);
    await sendResetMail({ ...recipient, verified: false });
    expect(sendMail).not.toHaveBeenCalled();
    budget(0, "unknown");
    await sendVerificationMail(recipient);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("leaves a verified member's reset and other security mail off the budget", async () => {
    budget(151, "degraded");
    await sendResetMail({ ...recipient, verified: true });
    await sendPasswordChangedMail(recipient);
    expect(consume).not.toHaveBeenCalled();
    expect(vi.mocked(sendMail).mock.calls.map(([mail]) => [mail.template, mail.anonymous])).toEqual([
      ["resetPassword", undefined],
      ["passwordChanged", undefined],
    ]);
  });
});
