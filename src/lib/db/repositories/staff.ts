import "server-only";
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { z } from "@/lib/zod";
import { db } from "@/lib/firebase/admin";
import { consume } from "@/lib/quota";
import { COLLECTIONS, displayNameSchema } from "../schemas";

// staff/{uid} (§6 "Personnel"): the back-office roster, one document per moderator or admin
// account. The role of record stays in the custom claims; this document carries what the claims
// cannot (who invited, when, revocation) and feeds the /personnel page. Written by the server only.

export const STAFF_COLLECTION = COLLECTIONS.staff;

export const staffRoleSchema = z.enum(["moderator", "admin"]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const staffDocSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: displayNameSchema,
    role: staffRoleSchema,
    /** uid of the admin who invited, or "script" for the first admin (scripts/create-admin.ts). */
    invitedBy: z.union([z.string().min(1).max(128), z.literal("script")]),
    createdAt: z.date(),
    revokedAt: z.date().optional(),
    /** Last invitation mailed (audit zone 7 P3-5); absent on entries written before it (active). */
    invitedAt: z.date().optional(),
    /** Password set or first sign-in since the last invitation: until then the member is "pending". */
    activatedAt: z.date().optional(),
  })
  .strict();
export type StaffDoc = z.infer<typeof staffDocSchema>;

export interface StaffRecord extends StaffDoc {
  uid: string;
}

export interface UpsertStaffInput {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  invitedBy: string | "script";
  /** An invitation is mailed now: a new or revoked member becomes pending (an active one stays active). */
  invited?: boolean;
  now?: Date;
}

const staffRef = (uid: string) => db().collection(STAFF_COLLECTION).doc(uid);

function toDate(value: unknown): unknown {
  return value instanceof Timestamp ? value.toDate() : value;
}

function fromSnapshot(snapshot: DocumentSnapshot): StaffRecord | null {
  const data = snapshot.data();
  if (!data) return null;
  const parsed = staffDocSchema.safeParse({
    ...data,
    createdAt: toDate(data["createdAt"]),
    revokedAt: toDate(data["revokedAt"]),
    invitedAt: toDate(data["invitedAt"]),
    activatedAt: toDate(data["activatedAt"]),
  });
  return parsed.success ? { uid: snapshot.id, ...parsed.data } : null;
}

function toFirestore(doc: StaffDoc): Record<string, unknown> {
  return {
    ...doc,
    createdAt: Timestamp.fromDate(doc.createdAt),
    ...(doc.revokedAt ? { revokedAt: Timestamp.fromDate(doc.revokedAt) } : {}),
    ...(doc.invitedAt ? { invitedAt: Timestamp.fromDate(doc.invitedAt) } : {}),
    ...(doc.activatedAt ? { activatedAt: Timestamp.fromDate(doc.activatedAt) } : {}),
  };
}

/**
 * When an invitation leaves the member active: a current member already active (activated, or an
 * entry older than the pending state, active since its creation) keeps that date; a new or revoked
 * member waits for the password (undefined).
 */
export function keptActivation(existing: StaffDoc | null): Date | undefined {
  if (!existing || existing.revokedAt) return undefined;
  return existing.activatedAt ?? (existing.invitedAt ? undefined : existing.createdAt);
}

/**
 * Creates or replaces the roster entry. A re-invitation keeps the original createdAt, takes the
 * new role and inviter, and clears any revocation; with `invited`, the entry records the mail and
 * a new or revoked member is pending until the password is set.
 */
export async function upsertStaff(input: UpsertStaffInput): Promise<StaffRecord> {
  const now = input.now ?? new Date();
  const existing = await getStaff(input.uid);
  const invitedAt = input.invited ? now : existing?.invitedAt;
  const activatedAt = input.invited ? keptActivation(existing) : existing?.activatedAt;
  const doc = staffDocSchema.parse({
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    invitedBy: input.invitedBy,
    createdAt: existing?.createdAt ?? now,
    ...(invitedAt ? { invitedAt } : {}),
    ...(activatedAt ? { activatedAt } : {}),
  });
  await staffRef(input.uid).set(toFirestore(doc));
  void consume("firestore.writes", 1);
  return { uid: input.uid, ...doc };
}

/** Marks the member revoked (the claims, sessions and Auth record are handled by the caller). */
export async function revokeStaff(uid: string, now = new Date()): Promise<void> {
  await staffRef(uid).update({ revokedAt: Timestamp.fromDate(now) });
  void consume("firestore.writes", 1);
}

/** The invitation was mailed again (still pending). */
export async function markStaffInvited(uid: string, now = new Date()): Promise<void> {
  await staffRef(uid).update({ invitedAt: Timestamp.fromDate(now) });
  void consume("firestore.writes", 1);
}

/** The member set their password or signed in: no longer pending. No-op when already active. */
export async function markStaffActivated(record: StaffRecord | null, now = new Date()): Promise<boolean> {
  if (!record || record.revokedAt || keptActivation(record)) return false;
  await staffRef(record.uid).update({ activatedAt: Timestamp.fromDate(now) });
  void consume("firestore.writes", 1);
  return true;
}

export async function getStaff(uid: string): Promise<StaffRecord | null> {
  const snapshot = await staffRef(uid).get();
  void consume("firestore.reads", 1);
  return fromSnapshot(snapshot);
}

/** Every roster entry, oldest first (revoked members included: the page shows their status). */
export async function listStaff(): Promise<StaffRecord[]> {
  const snapshot = await db().collection(STAFF_COLLECTION).orderBy("createdAt", "asc").get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  return snapshot.docs.map(fromSnapshot).filter((record): record is StaffRecord => record !== null);
}

/** Admins still active (role admin, not revoked): the back office must keep at least one. */
export async function listActiveAdmins(): Promise<StaffRecord[]> {
  const snapshot = await db().collection(STAFF_COLLECTION).where("role", "==", "admin").get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  return snapshot.docs.map(fromSnapshot).filter((record): record is StaffRecord => record !== null && record.revokedAt === undefined);
}
