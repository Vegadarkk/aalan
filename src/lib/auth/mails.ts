import "server-only";
import type { Locale } from "@/config/site";
import { sendMail } from "@/lib/mail";
import { maskEmail } from "@/lib/account/email-change-rules";
import { logger } from "@/lib/logging/logger";
import type { MailJob, TemplateId } from "@/lib/mail/types";
import { consume } from "@/lib/quota";
import { pepperedHash } from "@/lib/security/hash";
import { actionLinkRequest, changeEmailLinkRequest, pageUrl } from "./links";

// The security mails of the auth flows. Every one of them has priority "security": it bypasses
// the suppression list and falls back to the second provider (src/lib/mail).

interface Recipient {
  email: string;
  displayName: string;
  locale: Locale;
}

/**
 * A recipient whose address may be unproven: `displayName` null greets without a name, so a name
 * typed by whoever signed up is never mailed to an address nobody verified (same rule as the
 * report mails, src/lib/decisions/notify.ts).
 */
interface UnprovenRecipient extends Omit<Recipient, "displayName"> {
  displayName: string | null;
}

const hourBucket = () => Math.floor(Date.now() / 3_600_000);

/**
 * A mail an anonymous request causes: counted on its own daily budget (mail.anonymous.daily) and
 * skipped once that is spent, so such requests never use up the members' mail. Valkey unreadable:
 * sent (the per-IP and per-address limiters still hold).
 */
async function sendAnonymousMail<T extends TemplateId>(mail: MailJob<T>): Promise<void> {
  const spent = await consume("mail.anonymous.daily");
  if (spent.level !== "unknown" && spent.used > spent.limit) {
    logger.warn({ template: mail.template }, "mail skipped: anonymous mail budget spent");
    return;
  }
  await sendMail({ ...mail, anonymous: true });
}

/** Verification link of a pending account; one mail per account and hour at most (queue dedupe). */
export async function sendVerificationMail(input: UnprovenRecipient & { uid: string; next?: string }): Promise<void> {
  await sendAnonymousMail({
    template: "verifyEmail",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, actionLink: actionLinkRequest(input.locale, "verifyEmail", input.next) },
    priority: "security",
    idempotencyKey: `verify-${input.uid}-${hourBucket()}`,
  });
}

/** Sign-up attempt on an e-mail that already has an account: the answer to the browser stays the same; one mail per account and hour at most. */
export async function sendSignupExistingMail(input: UnprovenRecipient & { uid: string }): Promise<void> {
  await sendAnonymousMail({
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
export async function sendSignupClosedMail(input: UnprovenRecipient & { uid: string; closedAt: Date; reusableFrom: Date }): Promise<void> {
  await sendAnonymousMail({
    template: "signupClosed",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, closedAt: input.closedAt.toISOString(), reusableFrom: input.reusableFrom.toISOString() },
    priority: "security",
    idempotencyKey: `signup-closed-${input.uid}-${hourBucket()}`,
  });
}

/**
 * Change of address (Z1-10): the confirmation link, to the new address. The code is generated at
 * delivery from the account's current address (changeEmailLinkRequest); one mail per account,
 * address and hour at most.
 */
export async function sendEmailChangeMail(input: Recipient & { uid: string; currentEmail: string; expiresAt: Date }): Promise<void> {
  await sendMail({
    template: "emailChangeConfirm",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, expiresAt: input.expiresAt.toISOString(), actionLink: changeEmailLinkRequest(input.locale, input.currentEmail) },
    priority: "security",
    idempotencyKey: `email-change-${input.uid}-${pepperedHash("email", input.email.toLowerCase()).slice(0, 16)}-${hourBucket()}`,
  });
}

/** Change of address (Z1-10): the notice to the old address, the new one masked. */
export async function sendEmailChangedMail(input: Recipient & { uid: string; newEmail: string; at: Date }): Promise<void> {
  await sendMail({
    template: "emailChanged",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, newEmail: maskEmail(input.newEmail), at: input.at.toISOString() },
    priority: "security",
    idempotencyKey: `email-changed-${input.uid}-${input.at.getTime()}`,
  });
}

/** `verified`: the account proved its address; a never-verified one is mailed on the anonymous budget. */
export async function sendResetMail(input: UnprovenRecipient & { verified: boolean }): Promise<void> {
  const mail = {
    template: "resetPassword" as const,
    locale: input.locale,
    to: input.email,
    data: { displayName: input.verified ? input.displayName : null, actionLink: actionLinkRequest(input.locale, "resetPassword") },
    priority: "security" as const,
  };
  await (input.verified ? sendMail(mail) : sendAnonymousMail(mail));
}

/** One notice per account and hour while it waits in the queue: a loop of changes queues one mail. */
export async function sendPasswordChangedMail(input: Recipient & { uid: string }): Promise<void> {
  await sendMail({
    template: "passwordChanged",
    locale: input.locale,
    to: input.email,
    data: { displayName: input.displayName, at: new Date().toISOString() },
    priority: "security",
    idempotencyKey: `password-changed-${input.uid}-${hourBucket()}`,
  });
}
