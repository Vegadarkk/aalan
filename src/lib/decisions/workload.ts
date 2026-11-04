import "server-only";
import { Timestamp, type Query } from "firebase-admin/firestore";
import { REPORT_PRIORITIES, type ReportPriority } from "@/config/report-reasons";
import { auditLogSchema, COLLECTIONS, type AuditLogDoc } from "@/lib/db/schemas";
import { listStaff } from "@/lib/db/repositories/staff";
import { timestampsToDates } from "@/lib/db/repositories/timestamps";
import { db } from "@/lib/firebase/admin";
import { logger } from "@/lib/logging/logger";
import { aggregationReads, consume } from "@/lib/quota";
import { isValkeyConfigured, valkey } from "@/lib/valkey/clients";
import { activityKind } from "./activity";
import { APPEAL_SLA_DAYS } from "./contracts";
import { decisionsCol, reportsCol } from "./repository";

// The team's work in numbers for the back-office home and the section counters (zone 7 audit
// P2-6, P2-7): open and overdue reports per priority, held listings, open appeals, Pro requests to
// verify, open authority requests; and the staff's latest actions from the audit log. Count
// aggregations (one read per 1 000 entries) on existing indexes; cached a minute in Valkey (fail
// open: computed directly without Valkey). A failed read gives null: the page shows no figure
// rather than a false 0.

const WORKLOAD_KEY = "admin:workload:v1";
const ACTIVITY_KEY = "admin:activity:v1";
export const WORKLOAD_CACHE_SECONDS = 60;
/** Audit entries read for the activity feed (system entries and reads are skipped). */
export const ACTIVITY_SCAN = 60;
/** Entries kept: a moderator's feed drops the admin-only ones, the page shows 8. */
export const ACTIVITY_MAX = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN = ["open", "in_review"];

export interface Workload {
  generatedAt: string;
  reports: Record<ReportPriority, { open: number; overdue: number }>;
  /** Listings held for review (pending_review). */
  listingsHeld: number;
  appeals: { open: number; overdue: number };
  /** Pro applications sent and not decided (the Comptes Pro queue). */
  proRequests: number;
  /** Authority requests open or answered and not closed. */
  authoritiesOpen: number;
}

export interface StaffActivity {
  at: string;
  action: string;
  target: { type: string; id: string };
  actorRole: "moderator" | "admin";
  /** The staff member's display name, or null once the roster entry is gone. */
  actor: string | null;
}

async function count(query: Query): Promise<number> {
  const snapshot = await query.count().get();
  const value = snapshot.data().count;
  void consume("firestore.reads", aggregationReads(value));
  return value;
}

/** Computes the figures from Firestore (no cache). */
export async function computeWorkload(now = new Date()): Promise<Workload> {
  const reports = reportsCol();
  const nowTs = Timestamp.fromDate(now);
  // (status, priority, slaDueAt) is the queue's index: overdue counts go through it per priority.
  const perPriority = await Promise.all(
    REPORT_PRIORITIES.map(async (priority) => {
      const base = reports.where("status", "in", OPEN).where("priority", "==", priority);
      const [open, overdue] = await Promise.all([count(base), count(base.where("slaDueAt", "<", nowTs))]);
      return [priority, { open, overdue }] as const;
    }),
  );
  const decisions = decisionsCol();
  const appealOverdueBefore = Timestamp.fromDate(new Date(now.getTime() - APPEAL_SLA_DAYS * DAY_MS));
  const [listingsHeld, appealsOpen, appealsOverdue, proRequests, authoritiesOpen] = await Promise.all([
    count(db().collection(COLLECTIONS.listings).where("status", "==", "pending_review")),
    count(decisions.where("appeal.status", "==", "open")),
    count(decisions.where("appeal.status", "==", "open").where("appeal.openedAt", "<", appealOverdueBefore)),
    count(db().collection(COLLECTIONS.proProfiles).where("kybc.status", "==", "submitted")),
    count(db().collection(COLLECTIONS.authorityRequests).where("status", "in", ["open", "answered"])),
  ]);
  return {
    generatedAt: now.toISOString(),
    reports: Object.fromEntries(perPriority) as Workload["reports"],
    listingsHeld,
    appeals: { open: appealsOpen, overdue: appealsOverdue },
    proRequests,
    authoritiesOpen,
  };
}

/** The staff's latest moderation actions, newest first (system entries, reads and settings left out, src/lib/decisions/activity.ts). */
export async function computeStaffActivity(limit = ACTIVITY_MAX): Promise<StaffActivity[]> {
  const snapshot = await db().collection(COLLECTIONS.auditLogs).orderBy("at", "desc").limit(ACTIVITY_SCAN).get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  const entries: AuditLogDoc[] = [];
  for (const doc of snapshot.docs) {
    const parsed = auditLogSchema.safeParse(timestampsToDates(doc.data()));
    if (parsed.success && (parsed.data.actorRole === "moderator" || parsed.data.actorRole === "admin") && activityKind(parsed.data.action)) entries.push(parsed.data);
    if (entries.length >= limit) break;
  }
  const names = entries.length > 0 ? new Map((await listStaff()).map((member) => [member.uid, member.displayName])) : new Map<string, string>();
  return entries.map((entry) => ({
    at: entry.at.toISOString(),
    action: entry.action,
    target: entry.target,
    actorRole: entry.actorRole as StaffActivity["actorRole"],
    actor: names.get(entry.actorUid) ?? null,
  }));
}

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const cache = isValkeyConfigured("queue");
  if (cache) {
    try {
      const value = await valkey("queue").get(key);
      if (value) return JSON.parse(value) as T;
    } catch (error) {
      logger.warn({ err: (error as Error).message, key }, "admin: workload cache unavailable");
    }
  }
  const value = await compute();
  if (cache) {
    try {
      await valkey("queue").set(key, JSON.stringify(value), "EX", WORKLOAD_CACHE_SECONDS);
    } catch (error) {
      logger.warn({ err: (error as Error).message, key }, "admin: workload not cached");
    }
  }
  return value;
}

/** The figures, from the one-minute cache when there is one; null when Firestore cannot answer. */
export async function workload(now = new Date()): Promise<Workload | null> {
  try {
    return await cached(WORKLOAD_KEY, () => computeWorkload(now));
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "admin: workload unavailable");
    return null;
  }
}

/** The activity feed, from the one-minute cache when there is one; null when Firestore cannot answer. */
export async function staffActivity(): Promise<StaffActivity[] | null> {
  try {
    return await cached(ACTIVITY_KEY, () => computeStaffActivity());
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "admin: staff activity unavailable");
    return null;
  }
}
