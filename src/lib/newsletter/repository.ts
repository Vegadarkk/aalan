import "server-only";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { consume } from "@/lib/quota";
import { NEWSLETTER_CAMPAIGNS, type NewsletterCampaign } from "./campaigns";
import { subscriberId, type NewsletterLang } from "./token";

// newsletter/{subscriberId}: a confirmed address of the opening list. Written once, on the click
// of the confirmation link; deleted on unsubscribe, or with the whole list 30 days after the
// opening (./campaigns.ts). No IP, no device, no name. The campaigns' cursors live in
// system/newsletterCampaigns (src/worker/jobs/newsletter-campaigns.ts).

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

/** A subscriber read for a campaign: its document id and what the e-mail needs. */
export interface SubscriberEntry extends Subscriber {
  id: string;
}

/** Where a campaign stopped: the last subscriber served, in confirmation order. */
export interface CampaignCursor {
  afterAt: Date | null;
  afterId: string | null;
  sent: number;
  /** The window closed and its leftovers were reported. */
  closed?: boolean;
}

/** system/newsletterCampaigns: one cursor per campaign, the opening instant they were sent for, the purge. */
export interface CampaignState {
  opensAt: Date | null;
  campaigns: Partial<Record<NewsletterCampaign, CampaignCursor>>;
  purgedAt: Date | null;
}

const STATE_DOC = "newsletterCampaigns";
const stateRef = () => db().collection(COLLECTIONS.system).doc(STATE_DOC);
const toDate = (value: unknown): Date | null => (value instanceof Timestamp ? value.toDate() : null);

function parseLang(value: unknown): NewsletterLang | null {
  return value === "fr" || value === "ar" || value === "rif" ? value : null;
}

/**
 * Up to `limit` subscribers confirmed after the cursor, oldest first (confirmedAt, then id: the
 * single-field index and its implicit __name__ order). A malformed document is skipped but moves
 * the cursor (`last`).
 */
export async function listSubscribersAfter(
  cursor: Pick<CampaignCursor, "afterAt" | "afterId">,
  limit: number,
): Promise<{
  subscribers: SubscriberEntry[];
  read: number;
  last: { at: Date; id: string } | null;
}> {
  let query = db().collection(COLLECTIONS.newsletter).orderBy("confirmedAt").orderBy(FieldPath.documentId());
  if (cursor.afterAt && cursor.afterId) query = query.startAfter(Timestamp.fromDate(cursor.afterAt), cursor.afterId);
  const snapshot = await query.limit(limit).get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  const subscribers: SubscriberEntry[] = [];
  let last: { at: Date; id: string } | null = null;
  for (const doc of snapshot.docs) {
    const at = toDate(doc.get("confirmedAt"));
    if (!at) continue;
    last = { at, id: doc.id };
    const email: unknown = doc.get("email");
    const lang = parseLang(doc.get("lang"));
    if (typeof email === "string" && email.includes("@") && lang)
      subscribers.push({
        id: doc.id,
        email,
        lang,
        confirmedAt: Timestamp.fromDate(at),
      });
  }
  return { subscribers, read: snapshot.size, last };
}

function parseCursor(value: unknown): CampaignCursor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    afterAt: toDate(raw.afterAt),
    afterId: typeof raw.afterId === "string" && raw.afterId.length > 0 ? raw.afterId : null,
    sent: typeof raw.sent === "number" ? raw.sent : 0,
    ...(raw.closed === true ? { closed: true } : {}),
  };
}

export async function readCampaignState(): Promise<CampaignState> {
  const snapshot = await stateRef().get();
  void consume("firestore.reads", 1);
  const campaigns: CampaignState["campaigns"] = {};
  const stored: unknown = snapshot.get("campaigns");
  for (const id of NEWSLETTER_CAMPAIGNS) {
    const cursor = parseCursor(stored && typeof stored === "object" ? (stored as Record<string, unknown>)[id] : undefined);
    if (cursor) campaigns[id] = cursor;
  }
  return {
    opensAt: toDate(snapshot.get("opensAt")),
    campaigns,
    purgedAt: toDate(snapshot.get("purgedAt")),
  };
}

export async function writeCampaignState(state: CampaignState, now = new Date()): Promise<void> {
  const campaigns: Record<string, Record<string, unknown>> = {};
  for (const [id, cursor] of Object.entries(state.campaigns)) {
    campaigns[id] = {
      afterAt: cursor.afterAt ? Timestamp.fromDate(cursor.afterAt) : null,
      afterId: cursor.afterId ?? "",
      sent: cursor.sent,
      ...(cursor.closed ? { closed: true } : {}),
    };
  }
  await stateRef().set({
    opensAt: state.opensAt ? Timestamp.fromDate(state.opensAt) : null,
    campaigns,
    purgedAt: state.purgedAt ? Timestamp.fromDate(state.purgedAt) : null,
    updatedAt: Timestamp.fromDate(now),
  });
  void consume("firestore.writes", 1);
}

/** Deletes up to `limit` subscribers; returns how many were deleted (fewer than `limit`: the list is empty). */
export async function deleteSubscribers(limit: number): Promise<number> {
  const snapshot = await db().collection(COLLECTIONS.newsletter).limit(limit).get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  if (snapshot.empty) return 0;
  const batch = db().batch();
  for (const doc of snapshot.docs) batch.delete(doc.ref);
  await batch.commit();
  void consume("firestore.deletes", snapshot.size);
  return snapshot.size;
}
