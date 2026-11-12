import { z } from "@/lib/zod";
import { emailSchema, localeSchema, turnstileTokenSchema } from "./auth";

// Opening list (owner, 2026-11-12): the door's sign-up form, its confirmation and unsubscribe.

export { NEWSLETTER_API } from "./endpoints";

export const newsletterSubscribeSchema = z.object({ email: emailSchema, locale: localeSchema.default("fr"), turnstileToken: turnstileTokenSchema }).strict();
export type NewsletterSubscribeInput = z.infer<typeof newsletterSubscribeSchema>;

/** Confirm and unsubscribe: the signed token of the e-mail's link. */
export const newsletterTokenSchema = z.object({ token: z.string().min(16).max(1024) }).strict();

/** Every sign-up answers the same (202): whether the address was already on the list is never told. */
export interface NewsletterSubscribeResponse {
  status: "confirmation_sent";
}
