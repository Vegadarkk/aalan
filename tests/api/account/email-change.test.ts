import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Quota from "@/lib/quota";
import type * as Turnstile from "@/lib/security/turnstile";

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", async (importOriginal) => ({ ...(await importOriginal<typeof Quota>()), firstDegraded: vi.fn(async () => null) }));
vi.mock("@/lib/security/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof Turnstile>()),
  verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })),
}));

import { DELETE as cancelRoute, POST as requestRoute } from "@/app/api/account/email/route";
import { POST as action } from "@/app/api/auth/action/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as profile } from "@/app/api/auth/profile/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import type { EmailChangeResponse } from "@/lib/contracts/account";
import { ACCOUNT_API } from "@/lib/contracts/endpoints";
import { COLLECTIONS } from "@/lib/db/schemas";
import { emailNormHash, findUidByEmail, getUserPrivate } from "@/lib/db/repositories/users";
import { auth, db } from "@/lib/firebase/admin";
import { sendMail } from "@/lib/mail";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { CONSENTS, Jar, PASSWORD, actionUrlOf, call, capturedMails, lastMail, oobCodeOf, uniqueEmail, type ErrorBody, type SignedInBody } from "../auth/helpers";

// Change of e-mail address (audit Z1-10) on the emulators: re-authentication, a link to the new
// address only when it is free (same answer otherwise), the pending state, cancellation, the
// confirmation link (single use), the Auth record, emailIndex and private document moved, every
// session revoked, the notice to the old address, the audit entries.

const ME = "/api/auth/me";

beforeEach(() => {
  resetRateLimiters();
  vi.mocked(sendMail).mockClear();
});

/** Revocation has a one-second granularity: sessions minted in the same second survive it. */
const nextSecond = () => new Promise((resolve) => setTimeout(resolve, 1100));

/** A verified member signed in on `jar`. */
async function member(jar = new Jar()): Promise<{ jar: Jar; email: string; uid: string }> {
  const email = uniqueEmail("ec");
  const signed = await call(signup, "/api/auth/signup", { jar, body: { email, password: PASSWORD, displayName: "Salma Test", locale: "fr", consents: CONSENTS, turnstileToken: "t" } });
  expect(signed.status).toBe(202);
  const mail = lastMail(sendMail, "verifyEmail", email)!;
  const verified = await call<SignedInBody>(action, "/api/auth/action", { jar, body: { mode: "verifyEmail", oobCode: oobCodeOf(await actionUrlOf(mail)) } });
  expect(verified.body.session?.uid).toBeDefined();
  return { jar, email, uid: verified.body.session.uid };
}

const ask = (jar: Jar, body: unknown, options: { csrf?: boolean } = {}) => call<EmailChangeResponse & ErrorBody>(requestRoute, ACCOUNT_API.email, { jar, body, ...options });
const confirm = (oobCode: string) => call<{ status: string; email?: string } & ErrorBody>(action, "/api/auth/action", { jar: new Jar(), body: { mode: "changeEmail", oobCode } });

async function auditActions(uid: string): Promise<string[]> {
  const snapshot = await db().collection(COLLECTIONS.auditLogs).where("target.id", "==", uid).get();
  return snapshot.docs.map((doc) => String(doc.get("action"))).sort();
}

describe("change of e-mail address", () => {
  it("moves the account once the link sent to the new address is opened, then signs every device out", async () => {
    const { jar, email, uid } = await member();
    const newEmail = uniqueEmail("new");
    const before = capturedMails(sendMail).length;

    const asked = await ask(jar, { newEmail: newEmail.toUpperCase(), currentPassword: PASSWORD });
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ status: "pending", newEmail });
    const mails = capturedMails(sendMail).slice(before);
    expect(mails.map((mail) => [mail.template, mail.to])).toEqual([["emailChangeConfirm", newEmail]]);
    expect(mails[0]).toMatchObject({ priority: "security", data: { actionLink: { action: "changeEmail", currentEmail: email, url: "http://localhost:3000/fr/action?mode=changeEmail" } } });
    // Nothing moved yet: the session shows the pending change, the account keeps its address.
    const pending = await call<{ session: SignedInBody["session"] }>(me, ME, { jar });
    expect(pending.body.session.email).toBe(email);
    expect(pending.body.session.emailChange).toMatchObject({ newEmail });
    expect((await auth().getUser(uid)).email).toBe(email);

    const actionUrl = await actionUrlOf(mails[0]!);
    expect(actionUrl).toMatch(/^http:\/\/localhost:3000\/fr\/action\?mode=changeEmail&oobCode=/);
    await nextSecond();
    const done = await confirm(oobCodeOf(actionUrl));
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ status: "email_changed", email: newEmail });

    const record = await auth().getUser(uid);
    expect(record.email).toBe(newEmail);
    expect(record.emailVerified).toBe(true);
    const account = await getUserPrivate(uid);
    expect(account).toMatchObject({ email: newEmail, emailNormHash: emailNormHash(newEmail) });
    expect(account?.emailChange).toBeUndefined();
    expect(await findUidByEmail(newEmail)).toBe(uid);
    expect(await findUidByEmail(email)).toBeNull();
    // The notice to the old address, the new one masked.
    const notice = lastMail(sendMail, "emailChanged", email);
    expect(notice?.data.newEmail).toMatch(/^.•••••@/);
    expect(notice?.data.newEmail).not.toContain(newEmail.split("@")[0]!);
    expect(await auditActions(uid)).toEqual(["account.email_change", "account.email_change_request"]);

    // Every session was revoked; the new address signs in, the old one no longer does.
    expect((await call<ErrorBody>(profile, "/api/auth/profile", { jar, body: { displayName: "Ghost" } })).status).toBe(401);
    expect((await call<SignedInBody>(login, "/api/auth/login", { jar: new Jar(), body: { email: newEmail, password: PASSWORD } })).body.status).toBe("signed_in");
    expect((await call<ErrorBody>(login, "/api/auth/login", { jar: new Jar(), body: { email, password: PASSWORD } })).status).toBe(401);

    // Single use: the same link again is refused.
    const again = await confirm(oobCodeOf(actionUrl));
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("invalid_code");
  });

  it("asks for the right current password, a new address, a session and the CSRF header", async () => {
    const { jar, email } = await member();
    const wrong = await ask(jar, { newEmail: uniqueEmail("new"), currentPassword: "Not-the-password-1" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("invalid_credentials");
    const same = await ask(jar, { newEmail: email.replace("@", "+tag@"), currentPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe("same_email");
    expect((await ask(jar, { newEmail: "x@mailinator.com", currentPassword: PASSWORD })).body.error.code).toBe("disposable_email");
    expect((await ask(jar, { newEmail: uniqueEmail("new"), currentPassword: PASSWORD }, { csrf: false })).status).toBe(403);
    expect((await ask(new Jar(), { newEmail: uniqueEmail("new"), currentPassword: PASSWORD })).status).toBe(401);
    expect(capturedMails(sendMail).filter((mail) => mail.template === "emailChangeConfirm")).toHaveLength(0);
  });

  it("answers an address another account uses exactly like a free one, without mailing it", async () => {
    const { jar } = await member();
    const other = await member();
    const before = capturedMails(sendMail).length;
    const asked = await ask(jar, { newEmail: other.email, currentPassword: PASSWORD });
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ status: "pending", newEmail: other.email });
    expect(capturedMails(sendMail).slice(before)).toEqual([]);
  });

  it("a cancelled request no longer accepts its link", async () => {
    const { jar, email, uid } = await member();
    const newEmail = uniqueEmail("new");
    await ask(jar, { newEmail, currentPassword: PASSWORD });
    const mail = lastMail(sendMail, "emailChangeConfirm", newEmail)!;
    const cancelled = await call<EmailChangeResponse>(cancelRoute, ACCOUNT_API.email, { jar, method: "DELETE" });
    expect(cancelled.body).toEqual({ status: "cancelled" });
    expect((await getUserPrivate(uid))?.emailChange).toBeUndefined();
    const refused = await confirm(oobCodeOf(await actionUrlOf(mail)));
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("invalid_code");
    expect((await auth().getUser(uid)).email).toBe(email);
  });

  it("refuses the link when the new address got an account in between, and changes nothing", async () => {
    const { jar, email, uid } = await member();
    const newEmail = uniqueEmail("new");
    await ask(jar, { newEmail, currentPassword: PASSWORD });
    const mail = lastMail(sendMail, "emailChangeConfirm", newEmail)!;
    const code = oobCodeOf(await actionUrlOf(mail));
    await member(new Jar()).then(async (other) => {
      // Simulates the race: the index entry of the new address now belongs to another account.
      await db().collection(COLLECTIONS.emailIndex).doc(emailNormHash(newEmail)).set({ uid: other.uid, createdAt: new Date() });
    });
    const refused = await confirm(code);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("conflict");
    expect((await auth().getUser(uid)).email).toBe(email);
    expect((await getUserPrivate(uid))?.email).toBe(email);
  });

  it("a Google-only account is told to choose a password first", async () => {
    const { jar, uid } = await member();
    await db().collection(COLLECTIONS.users).doc(uid).collection(COLLECTIONS.userPrivate).doc(COLLECTIONS.userPrivateDoc).update({ providers: ["google.com"] });
    const refused = await ask(jar, { newEmail: uniqueEmail("new"), currentPassword: PASSWORD });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("password_required");
  });
});
