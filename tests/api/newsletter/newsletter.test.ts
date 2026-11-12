import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Opening list on the emulator (owner, 2026-11-12): the door's sign-up answers 202 whatever the
// address, sends one confirmation e-mail and stores nothing; the confirmation link's token adds the
// address once; the unsubscribe token (one-click ?t= or { token }) removes it. Same-origin sign-up,
// token-only confirm and unsubscribe, no GET.

vi.mock("@/lib/mail/deliver", () => ({ deliverMail: vi.fn(async () => ({ provider: "memory", id: "test" })) }));

import * as confirmRoute from "@/app/api/newsletter/confirm/route";
import * as subscribeRoute from "@/app/api/newsletter/subscribe/route";
import * as unsubscribeRoute from "@/app/api/newsletter/unsubscribe/route";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { deliverMail } from "@/lib/mail/deliver";
import type { TemplateMail } from "@/lib/mail/types";
import { confirmToken, subscriberId, unsubscribeToken } from "@/lib/newsletter/token";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { call, expectError, type ErrorBody } from "../favorites/helpers";

const subscribe = (body: unknown, options: { origin?: string | null; ip?: string } = {}) => call<ErrorBody & { status?: string }>(subscribeRoute.POST, "POST", "/api/newsletter/subscribe", { body, ...options });
const confirm = (token: string) => call<ErrorBody>(confirmRoute.POST, "POST", "/api/newsletter/confirm", { body: { token }, origin: null });
const subscriberDoc = (email: string) => db().collection(COLLECTIONS.newsletter).doc(subscriberId(email)).get();
const confirmMails = (): TemplateMail<"newsletterConfirm">[] =>
  vi
    .mocked(deliverMail)
    .mock.calls.map(([mail]) => mail as TemplateMail)
    .filter((mail): mail is TemplateMail<"newsletterConfirm"> => mail.template === "newsletterConfirm");
const tokenOf = (mail: TemplateMail<"newsletterConfirm"> | undefined) => decodeURIComponent(mail?.data.confirmUrl.split("#confirmer=")[1] ?? "");

beforeAll(() => resetServerEnv());
beforeEach(() => {
  resetRateLimiters();
  vi.mocked(deliverMail).mockClear();
});

describe("POST /api/newsletter/subscribe", () => {
  it("sends one confirmation link to the door of the visitor's language and stores nothing", async () => {
    const result = await subscribe({ email: "Nadia.Sub@Example.com", locale: "ar", turnstileToken: "dev" });
    expect([result.status, result.body.status]).toEqual([202, "confirmation_sent"]);
    const [mail, ...rest] = confirmMails();
    expect(rest).toHaveLength(0);
    expect(mail?.to).toBe("nadia.sub@example.com");
    expect(mail?.locale).toBe("ar");
    expect(mail?.data.confirmUrl).toMatch(/^http:\/\/localhost:3000\/ar#confirmer=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect((await subscriberDoc("nadia.sub@example.com")).exists).toBe(false);
  });

  it("refuses another origin, a disposable address and a malformed body", async () => {
    expectError(await subscribe({ email: "x@example.com", locale: "fr", turnstileToken: "dev" }, { origin: "https://evil.example" }), 403, "origin");
    expectError(await subscribe({ email: "x@mailinator.com", locale: "fr", turnstileToken: "dev" }), 400, "disposable_email");
    expectError(await subscribe({ email: "not-an-address", locale: "fr", turnstileToken: "dev" }), 400, "invalid_body");
    expect(confirmMails()).toHaveLength(0);
  });

  it("mails an address once per 10 minutes, and never one already on the list, with the same answer", async () => {
    const email = "repeat.sub@example.com";
    for (let i = 0; i < 3; i += 1) expect((await subscribe({ email, locale: "fr", turnstileToken: "dev" }, { ip: `10.98.7.${i + 1}` })).status).toBe(202);
    expect(confirmMails()).toHaveLength(1);
    expect((await confirm(tokenOf(confirmMails()[0]))).status).toBe(204);
    resetRateLimiters();
    vi.mocked(deliverMail).mockClear();
    expect((await subscribe({ email, locale: "fr", turnstileToken: "dev" })).status).toBe(202);
    expect(confirmMails()).toHaveLength(0);
  });
});

describe("POST /api/newsletter/confirm and /unsubscribe", () => {
  it("adds the address once with its language, then one-click removes it", async () => {
    const email = "confirm.sub@example.com";
    await subscribe({ email, locale: "rif", turnstileToken: "dev" });
    const token = tokenOf(confirmMails()[0]);
    expect((await confirm(token)).status).toBe(204);
    const first = await subscriberDoc(email);
    expect(first.data()).toMatchObject({ email, lang: "rif" });
    // A second click keeps the first confirmation.
    expect((await confirm(token)).status).toBe(204);
    expect((await subscriberDoc(email)).get("confirmedAt").isEqual(first.get("confirmedAt"))).toBe(true);

    const oneClick = await call<ErrorBody>(unsubscribeRoute.POST, "POST", `/api/newsletter/unsubscribe?t=${encodeURIComponent(unsubscribeToken(email))}`, {
      origin: null,
      rawBody: { text: "List-Unsubscribe=One-Click", type: "application/x-www-form-urlencoded" },
    });
    expect(oneClick.status).toBe(204);
    expect((await subscriberDoc(email)).exists).toBe(false);
    // Idempotent, from the door page's button too.
    expect((await call<ErrorBody>(unsubscribeRoute.POST, "POST", "/api/newsletter/unsubscribe", { body: { token: unsubscribeToken(email) } })).status).toBe(204);
  });

  it("refuses an expired, altered or crossed token, and has no GET", async () => {
    const expired = confirmToken("late.sub@example.com", "fr", Date.now() - 49 * 3_600_000);
    expectError(await confirm(expired), 400, "invalid_token");
    expectError(await confirm(`${confirmToken("x.sub@example.com", "fr")}x`), 400, "invalid_token");
    expectError(await confirm(unsubscribeToken("x.sub@example.com")), 400, "invalid_token");
    expectError(await call<ErrorBody>(unsubscribeRoute.POST, "POST", "/api/newsletter/unsubscribe", { body: { token: confirmToken("x.sub@example.com", "fr") } }), 400, "invalid_token");
    expect((await subscriberDoc("late.sub@example.com")).exists).toBe(false);
    expect("GET" in confirmRoute).toBe(false);
    expect("GET" in unsubscribeRoute).toBe(false);
  });
});
