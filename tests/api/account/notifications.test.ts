import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/account/notifications/route";
import type { NotificationSettings } from "@/lib/contracts/account";
import { MARKETING_CONSENT_VERSION } from "@/lib/contracts/auth";
import { ACCOUNT_API } from "@/lib/contracts/endpoints";
import { getUserPrivate } from "@/lib/db/repositories/users";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { call, expectError, member, type ErrorBody, type Member } from "../favorites/helpers";

// GET and POST /api/account/notifications on the emulators (audit B2: Z1-02, zone 5 n°4): the
// marketing opt-in can be withdrawn and given again (with its proof), the messaging e-mails turned
// off and on, only for the session's own account.

type Body = NotificationSettings & ErrorBody;
const read = (who?: Member) => call<Body>(GET, "GET", ACCOUNT_API.notifications, { member: who });
const save = (who: Member | undefined, body: unknown, options: { csrf?: boolean } = {}) => call<Body>(POST, "POST", ACCOUNT_API.notifications, { member: who, body, ...options });

beforeEach(() => resetRateLimiters());

describe("/api/account/notifications", () => {
  it("needs a session, and CSRF to change anything", async () => {
    expectError(await read(), 401, "unauthenticated");
    const who = await member();
    expectError(await save(who, { marketing: true }, { csrf: false }), 403, "csrf");
  });

  it("reads the defaults: no marketing opt-in, messaging e-mails on", async () => {
    const who = await member();
    const result = await read(who);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ marketing: false, marketingSince: null, messagesEmail: true });
  });

  it("gives, keeps and withdraws the marketing opt-in with its proof", async () => {
    const who = await member();
    const given = await save(who, { marketing: true });
    expect(given.status).toBe(200);
    expect(given.body.marketing).toBe(true);
    const since = given.body.marketingSince;
    expect(since).not.toBeNull();
    expect((await getUserPrivate(who.uid))?.consents.marketingConsent?.version).toBe(MARKETING_CONSENT_VERSION);

    // A repeated opt-in keeps the first date.
    expect((await save(who, { marketing: true })).body.marketingSince).toBe(since);

    const withdrawn = await save(who, { marketing: false });
    expect(withdrawn.body).toMatchObject({ marketing: false, marketingSince: null });
    const account = await getUserPrivate(who.uid);
    expect(account?.consents.marketing).toBe(false);
    expect(account?.consents.marketingConsent).toBeUndefined();
  });

  it("turns the messaging e-mails off and on", async () => {
    const who = await member();
    expect((await save(who, { messagesEmail: false })).body.messagesEmail).toBe(false);
    expect((await getUserPrivate(who.uid))?.notifications?.messagesEmail).toBe(false);
    expect((await save(who, { messagesEmail: true })).body.messagesEmail).toBe(true);
  });

  it("refuses unknown fields", async () => {
    const who = await member();
    expect((await save(who, { marketing: true, uid: "someone-else" })).status).toBe(400);
  });
});
