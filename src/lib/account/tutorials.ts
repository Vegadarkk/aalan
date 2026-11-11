import "server-only";
import { requireUser } from "@/lib/auth/guards";
import { tutorialSettingsSchema, type TutorialSettings } from "@/lib/contracts/account";
import { COLLECTIONS, tutorialPrefsSchema } from "@/lib/db/schemas";
import { timestampsToDates } from "@/lib/db/repositories/timestamps";
import { db } from "@/lib/firebase/admin";
import { readJson } from "@/lib/http/json";
import { json } from "@/lib/http/route";
import { consume } from "@/lib/quota";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { cleanSeen } from "@/lib/tours/catalog";

// Guided tours of the signed-in member (owner, 2026-11-11): the tours gone through and the
// « Afficher les tutoriels » switch, in users/{uid}/prefs/tutorials (see tutorialPrefsSchema).
// The browser keeps its own copy and asks only while a tour is still unseen on that device. The
// uid comes from the session, never from the body.

const tutorialsRef = (uid: string) => db().collection(COLLECTIONS.users).doc(uid).collection(COLLECTIONS.prefs).doc(COLLECTIONS.prefsTutorialsDoc);

/** The member's tours; nothing stored (or a document this image cannot read) is a fresh start. */
export async function readTutorials(uid: string): Promise<TutorialSettings> {
  const snapshot = await tutorialsRef(uid).get();
  void consume("firestore.reads", 1);
  if (!snapshot.exists) return { seen: [], off: false };
  const parsed = tutorialPrefsSchema.safeParse(timestampsToDates(snapshot.data()));
  return parsed.success ? { seen: cleanSeen(parsed.data.seen), off: parsed.data.off } : { seen: [], off: false };
}

/** The settings after a change: only the fields sent move. */
export function nextTutorials(current: TutorialSettings, input: { seen?: readonly string[]; off?: boolean }): TutorialSettings {
  return { seen: input.seen === undefined ? current.seen : cleanSeen(input.seen), off: input.off ?? current.off };
}

export function sameTutorials(a: TutorialSettings, b: TutorialSettings): boolean {
  return a.off === b.off && a.seen.length === b.seen.length && a.seen.every((id, index) => b.seen[index] === id);
}

/** Deletes users/{uid}/prefs/tutorials (account closure); a missing document is fine. */
export async function deleteTutorials(uid: string): Promise<void> {
  await tutorialsRef(uid).delete();
  void consume("firestore.deletes", 1);
}

/** GET /api/account/tutorials. */
export async function handleTutorialsRead(request: Request): Promise<Response> {
  const { user } = await requireUser(request);
  return json(await readTutorials(user.uid));
}

/** POST /api/account/tutorials. */
export async function handleTutorialsUpdate(request: Request): Promise<Response> {
  const context = await requireUser(request, { mutation: true });
  const input = await readJson(request, tutorialSettingsSchema);
  const { uid } = context.user;
  await enforceLimit("tutorials.uid", uid);
  const current = await readTutorials(uid);
  const next = nextTutorials(current, input);
  if (sameTutorials(current, next)) return json(current);
  await tutorialsRef(uid).set({ seen: next.seen, off: next.off, updatedAt: new Date() });
  void consume("firestore.writes", 1);
  return json(next);
}
