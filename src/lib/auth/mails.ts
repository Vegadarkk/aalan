import "server-only";
import type { Locale } from "@/config/site";
import { sendMail } from "@/lib/mail";
import { actionLinkRequest, pageUrl } from "./links";

// The security mails of the auth flows. Every one of them has priority "security": it bypasses
// the suppression list and falls back to the second provider (src/lib/mail).

interface Recipient {
  email: string;
  displayName: string;
  locale: Locale;
}

const hourBucket = () => Math.floor(Date.now() / 3_600_000);

/** Verification link of a pending account; one mail per account and hour at most (queue dedupe). */
export async function sendVerificationMail(input: Recipient & { uid: string; next?: string }): Promise<void> {
  await sendMail({
    template: "verifyEmail",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, actionLink: actionLinkRequest(input.locale, "verifyEmail", input.next) },
    priority: "security",
    idempotencyKey: `verify-${input.uid}-${hourBucket()}`,
  });
}

/** Sign-up attempt on an e-mail that already has an account: the answer to the browser stays the same; one mail per account and hour at most. */
export async function sendSignupExistingMail(input: Recipient & { uid: string }): Promise<void> {
  await sendMail({
    template: "signupExisting",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, loginUrl: pageUrl(input.locale, "connexion"), resetUrl: pageUrl(input.locale, "mot-de-passe-oublie") },
    priority: "security",
    idempotencyKey: `signup-existing-${input.uid}-${hourBucket()}`,
  });
}

/**
 * Sign-up attempt on the e-mail of a closed account (Z1-11): what happened to the account, when the
 * address serves again, whom to write to. Same answer to the browser, same hourly cap as above.
 */
export async function sendSignupClosedMail(input: Recipient & { uid: string; closedAt: Date; reusableFrom: Date }): Promise<void> {
  await sendMail({
    template: "signupClosed",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, closedAt: input.closedAt.toISOString(), reusableFrom: input.reusableFrom.toISOString() },
    priority: "security",
    idempotencyKey: `signup-closed-${input.uid}-${hourBucket()}`,
  });
}

export async function sendResetMail(input: Recipient): Promise<void> {
  await sendMail({
    template: "resetPassword",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, actionLink: actionLinkRequest(input.locale, "resetPassword") },
    priority: "security",
  });
}

export async function sendPasswordChangedMail(input: Recipient): Promise<void> {
  await sendMail({
    template: "passwordChanged",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, at: new Date().toISOString() },
    priority: "security",
  });
}
