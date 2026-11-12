import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { subscriberId, type NewsletterLang } from "./token";

// newsletter/{subscriberId}: a confirmed address of the opening list. Written once, on the click
// of the confirmation link; deleted on unsubscribe. No IP, no device, no name.

export interface Subscriber {
  /** The address as the visitor typed it (trimmed, lower case): the one the e-mails go to. */
  email: string;
  lang: NewsletterLang;
  confirmedAt: Timestamp;
}

const ALREADY_EXISTS = 6;

const ref = (id: string) => db().collection(COLLECTIONS.newsletter).doc(id);

/** Whether the address is already confirmed on the list. */
export async function isSubscribed(email: string): Promise<boolean> {
  return (await ref(subscriberId(email)).get()).exists;
}

/** Adds a confirmed address; a second click on the link keeps the first confirmation. */
export async function confirmSubscriber(email: string, lang: NewsletterLang, now = new Date()): Promise<void> {
  const doc: Subscriber = { email, lang, confirmedAt: Timestamp.fromDate(now) };
  try {
    await ref(subscriberId(email)).create(doc);
  } catch (error) {
    if ((error as { code?: unknown }).code !== ALREADY_EXISTS) throw error;
  }
}

/** Removes the subscriber; an address already gone answers the same. */
export async function removeSubscriber(id: string): Promise<void> {
  await ref(id).delete();
}
