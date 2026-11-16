import "server-only";
import { COLLECTIONS, mailSuppressionSchema, type MailSuppressionDoc } from "@/lib/db/schemas";
import { db, isFirebaseConfigured } from "@/lib/firebase/admin";
import { logger } from "@/lib/logging/logger";
import { consume } from "@/lib/quota";
import { pepperedHash } from "@/lib/security/hash";

// mailSuppressions/{hash} (§5): addresses that bounced permanently or complained. Only non-security
// mails honour the list; the key is a peppered hash, the address itself is never stored. A bounce
// belongs to the exact mailbox: the key is the address as written (trimmed, lower-cased), never the
// normalized identity of emailNormHash (+tag dropped), or a variant's bounce would silence the base.

/** The suppression key of an address: exact mailbox, not the lossy identity key. */
export function suppressionKey(email: string): string {
  return pepperedHash("mail-suppression", email.trim().toLowerCase());
}

const ref = (email: string) => db().collection(COLLECTIONS.mailSuppressions).doc(suppressionKey(email));

/** True when the address must not receive transactional mail. A failing lookup never blocks a send. */
export async function isSuppressed(email: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const snapshot = await ref(email).get();
    void consume("firestore.reads", 1);
    return snapshot.exists;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "mail suppression lookup failed");
    return false;
  }
}

export async function addSuppression(email: string, reason: MailSuppressionDoc["reason"], provider: string, at = new Date()): Promise<void> {
  if (!isFirebaseConfigured()) {
    logger.warn({ reason, provider }, "mail suppression not stored (Firebase not configured)");
    return;
  }
  const doc = mailSuppressionSchema.parse({ reason, provider: provider.slice(0, 20), at });
  await ref(email).set(doc, { merge: true });
  void consume("firestore.writes", 1);
  logger.info({ reason, provider }, "mail suppression added");
}

export async function removeSuppression(email: string): Promise<void> {
  if (!isFirebaseConfigured()) return;
  await ref(email).delete();
  void consume("firestore.deletes", 1);
}
