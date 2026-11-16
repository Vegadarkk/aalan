import "server-only";
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { alert } from "@/lib/alert";
import { logger } from "@/lib/logging/logger";
import { pepperedHash, safeEqual } from "@/lib/security/hash";
import { isValkeyConfigured, valkey } from "@/lib/valkey/clients";

// Activity counters of the shops (spec §5 "Compteurs", UX audit of the Pro shops, lot 1): counted
// in valkey-queue (persistent), one hash per UTC day, then written once a night into
// shopStats/{proId} by stats-flush (src/lib/stats/flush.ts). Never a Firestore write per event.
//
// Fields of stats:day:{YYYY-MM-DD}:
//   s:{proId}:v   storefront views (one per visitor and day)
//   s:{proId}:c   conversations started with the shop, from its storefront or one of its listings
//   s:{proId}:r   numbers and WhatsApp revealed (first reveal of each member)
//   l:{id}:v      listing views (one per visitor and day); the shop is found at flush time
//   l:{id}:c      conversations started about the listing
// A visitor is the hashed device key (cookie, else the IP's subscriber bucket): no IP or uid is
// stored. Best effort everywhere: a counter never fails or slows the request that feeds it.
//
// valkey-queue never evicts and also brokers the jobs: request-keyed data must stay within a fixed
// budget there. The once-a-day dedupe keys live in valkey-ratelimit (evicts: a lost key only counts
// a view twice), and the day hash stops taking fields at STATS_DAY_MAX_FIELDS (alert, nothing lost
// but the extra counts). Ids reach countView only when the page signed them (viewToken).

export const STATS_DAY_TTL_MS = 8 * 24 * 3_600_000;
/** One view per visitor and day: a bit past a day, the day key changes anyway. */
export const STATS_SEEN_TTL_SECONDS = 26 * 3_600;
const VALKEY_TIMEOUT_MS = 500;
/**
 * Fields of one day hash (three metrics per listing or shop at most): far above the catalogue at
 * launch, a few MB of valkey-queue at worst, and what the nightly flush can read in one go.
 */
export const STATS_DAY_MAX_FIELDS = 60_000;
export const STATS_DAY_FULL_ALERT_TITLE = "Compteurs de vues : plafond du jour atteint";

export const STATS_KEYS = {
  day: (day: string) => `stats:day:${day}`,
  seen: (day: string, scope: StatsScope, id: string, visitor: string) => `stats:seen:${day}:${scope}:${id}:${visitor}`,
} as const;

export type StatsScope = "s" | "l";
export type StatsMetric = "v" | "c" | "r";

export type StatsValkey = Pick<Redis, "multi" | "set" | "hgetall" | "hlen" | "del">;
export type SeenValkey = Pick<Redis, "set">;

let clientForTests: StatsValkey | null | undefined;
let seenForTests: SeenValkey | null | undefined;

/**
 * Tests: a fake client (null = behave as unconfigured); undefined restores the real one. `seen`
 * stands for valkey-ratelimit (defaults to the same fake).
 */
export function setStatsValkeyForTests(client: StatsValkey | null | undefined, seen?: SeenValkey | null): void {
  clientForTests = client;
  seenForTests = seen === undefined ? client : seen;
}

/** The day hashes: valkey-queue (persistent until the nightly flush). */
export function statsClient(): StatsValkey | null {
  if (clientForTests !== undefined) return clientForTests;
  return isValkeyConfigured("queue") ? valkey("queue") : null;
}

/** The once-a-day dedupe keys: valkey-ratelimit, never the job broker. */
function seenClient(): SeenValkey | null {
  if (clientForTests !== undefined) return seenForTests ?? null;
  return isValkeyConfigured("ratelimit") ? valkey("ratelimit") : null;
}

/**
 * The signature a listing or storefront page gives its view beacon: only ids the site rendered are
 * counted, so made-up ids never reach the counters. Stable (cached pages), keyed by HASH_PEPPER.
 */
export function viewToken(scope: StatsScope, id: string): string {
  return pepperedHash("stats-view", `${scope}:${id}`).slice(0, 22);
}

export function isValidViewToken(scope: StatsScope, id: string, token: string | undefined): boolean {
  return typeof token === "string" && safeEqual(viewToken(scope, id), token);
}

/** The UTC day of `at`, YYYY-MM-DD. */
export function statsDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function timed<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("valkey timeout")), VALKEY_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function visitorHash(deviceKey: string): string {
  return createHash("sha256").update(`stats:${deviceKey}`).digest("base64url").slice(0, 16);
}

async function bump(fields: [StatsScope, string, StatsMetric][], now: Date): Promise<void> {
  const client = statsClient();
  if (!client || fields.length === 0) return;
  const key = STATS_KEYS.day(statsDay(now));
  try {
    if ((await timed(client.hlen(key))) >= STATS_DAY_MAX_FIELDS) {
      void alert({
        severity: "P2",
        title: STATS_DAY_FULL_ALERT_TITLE,
        body: `${key} a atteint ${STATS_DAY_MAX_FIELDS} champs : les vues et contacts ne sont plus comptés jusqu'à minuit UTC. Un afflux d'identifiants est probable ; la clé est vidée par le flush de la nuit (stats-flush).`,
      });
      return;
    }
    let chain = client.multi();
    for (const [scope, id, metric] of fields) chain = chain.hincrby(key, `${scope}:${id}:${metric}`, 1);
    await timed(chain.pexpire(key, STATS_DAY_TTL_MS).exec());
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "stats counter unavailable");
  }
}

/** A view of a storefront or a listing, counted once per visitor and day. True when it counted. */
export async function countView(scope: StatsScope, id: string, deviceKey: string, now = new Date()): Promise<boolean> {
  const seen = seenClient();
  if (!seen || !statsClient()) return false;
  const day = statsDay(now);
  try {
    const first = await timed(seen.set(STATS_KEYS.seen(day, scope, id, visitorHash(deviceKey)), "1", "EX", STATS_SEEN_TTL_SECONDS, "NX"));
    if (first !== "OK") return false;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "stats counter unavailable");
    return false;
  }
  await bump([[scope, id, "v"]], now);
  return true;
}

/** A conversation started: about a listing (`listingId`) and/or with a shop (`proId`). */
export function countContact(target: { listingId?: string; proId?: string }, now = new Date()): Promise<void> {
  const fields: [StatsScope, string, StatsMetric][] = [];
  if (target.listingId) fields.push(["l", target.listingId, "c"]);
  if (target.proId) fields.push(["s", target.proId, "c"]);
  return bump(fields, now);
}

/** A shop's number or WhatsApp revealed for the first time to a member (storefront or listing). */
export function countReveal(proId: string, now = new Date()): Promise<void> {
  return bump([["s", proId, "r"]], now);
}
