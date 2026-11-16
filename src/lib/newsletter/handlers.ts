import "server-only";
import mailchecker from "mailchecker";
import { anonymous, beginAnonymous, checkTurnstile, respond, uniformDuration } from "@/lib/auth/anonymous";
import { newsletterSubscribeSchema, newsletterTokenSchema, type NewsletterSubscribeResponse } from "@/lib/contracts/newsletter";
import { emailNormHash } from "@/lib/db/repositories/users";
import { serverEnv } from "@/lib/env";
import { parseOpensAt } from "@/lib/launch/gate";
import { HttpError } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { noContent } from "@/lib/http/route";
import { logger } from "@/lib/logging/logger";
import { enqueueMail } from "@/lib/mail/send";
import { assertQuotas, SIGNUP_QUOTAS } from "@/lib/quota/gate";
import { requestIdentity } from "@/lib/rate-limit/keys";
import { consumeLimit, enforceLimit } from "@/lib/rate-limit/limiter";
import { confirmSubscriber, isSubscribed, removeSubscriber } from "./repository";
import { CONFIRM_TTL_MS, confirmToken, verifyConfirmToken, verifyUnsubscribeToken } from "./token";

// The opening list (owner, 2026-11-12): the door's e-mail sign-up, with double opt-in.
//   POST /api/newsletter/subscribe   { email, locale, turnstileToken } -> 202, always the same answer
//   POST /api/newsletter/confirm     { token } -> 204: the address joins the list
//   POST /api/newsletter/unsubscribe ?t= (RFC 8058 one-click) or { token } -> 204: it leaves it
// The sign-up is an anonymous mutation (same origin, Turnstile, limits per IP). It stores nothing:
// the confirmation link carries the address, signed, for 48 hours (./token.ts). One confirmation
// e-mail per address every 10 minutes and 3 a day, skipped without a word beyond that, so the
// form cannot flood a stranger's inbox and never tells whether an address is on the list.
// Confirm and unsubscribe are token-authenticated, like the alerts' unsubscribe: the door page
// posts the token from the link's fragment, so a mail scanner opening the link changes nothing.

const invalidToken = () => new HttpError(400, "invalid_token");
const CONFIRMATION_SENT: NewsletterSubscribeResponse = { status: "confirmation_sent" };

/** The door page of the visitor's language: the links' tokens ride in its fragment, never sent to a server log. */
export function doorUrl(locale: string, fragment: string): string {
  return `${serverEnv().SITE_URL.replace(/\/$/, "")}/${locale}#${fragment}`;
}

/** The opening instant while it is still ahead, for the confirmation e-mail. */
function opensAtIso(now: number): string | null {
  const at = parseOpensAt(serverEnv().OPENS_AT);
  return at && at.getTime() > now ? at.toISOString() : null;
}

async function mayMail(email: string): Promise<boolean> {
  const key = emailNormHash(email);
  for (const id of ["newsletter.subscribe.email.burst", "newsletter.subscribe.email"] as const) {
    const outcome = await consumeLimit(id, key);
    if (!outcome.ok) return false;
  }
  return true;
}

async function subscribe(request: Request): Promise<Response> {
  const flow = beginAnonymous(request);
  const input = await readJson(request, newsletterSubscribeSchema);
  await enforceLimit("newsletter.subscribe.ip", flow.identity.ipBucket);
  await checkTurnstile(flow, input.turnstileToken, "newsletter");
  if (!mailchecker.isValid(input.email)) throw new HttpError(400, "disposable_email");
  if (!(await isSubscribed(input.email)) && (await mayMail(input.email))) {
    const now = Date.now();
    // The link is a sign-up confirmation, not an account key: it may wait in the queue (a few
    // seconds) and can only add this address to the list.
    await enqueueMail({
      template: "newsletterConfirm",
      locale: input.locale,
      to: input.email,
      priority: "transactional",
      data: {
        confirmUrl: doorUrl(input.locale, `confirmer=${confirmToken(input.email, input.locale, now)}`),
        expiresAt: new Date(now + CONFIRM_TTL_MS).toISOString(),
        opensAt: opensAtIso(now),
      },
    });
  }
  // Same duration whether the address was already on the list or limited (timing enumeration).
  await uniformDuration(flow);
  return respond(flow, CONFIRMATION_SENT, { status: 202 });
}

async function confirm(request: Request): Promise<Response> {
  await enforceLimit("newsletter.token.ip", requestIdentity(request.headers).ipBucket);
  const target = verifyConfirmToken((await readJson(request, newsletterTokenSchema)).token);
  if (!target) throw invalidToken();
  await assertQuotas(SIGNUP_QUOTAS);
  await confirmSubscriber(target.email, target.lang);
  logger.info({ lang: target.lang }, "newsletter: address confirmed");
  return noContent();
}

async function tokenOf(request: Request): Promise<string> {
  const query = new URL(request.url).searchParams.get("t");
  if (query !== null) {
    const parsed = newsletterTokenSchema.shape.token.safeParse(query);
    if (!parsed.success) throw invalidToken();
    return parsed.data;
  }
  return (await readJson(request, newsletterTokenSchema)).token;
}

async function unsubscribe(request: Request): Promise<Response> {
  await enforceLimit("newsletter.token.ip", requestIdentity(request.headers).ipBucket);
  const id = verifyUnsubscribeToken(await tokenOf(request));
  if (!id) throw invalidToken();
  await removeSubscriber(id);
  return noContent();
}

export const handleNewsletterSubscribe = anonymous(subscribe);
export const handleNewsletterConfirm = confirm;
export const handleNewsletterUnsubscribe = unsubscribe;
