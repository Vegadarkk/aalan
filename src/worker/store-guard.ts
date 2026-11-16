import type { Redis } from "ioredis";
import { QUOTAS } from "@/config/quotas";
import type { Alert } from "@/lib/alert";
import { logger } from "@/lib/logging/logger";
import { usedMemoryBytes } from "@/lib/quota/valkey-memory";
import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL } from "@/lib/health";

// The worker against a full or failing valkey-queue. That store never evicts: at maxmemory it
// refuses every write, BullMQ's fetch and scheduler scripts included, and a Worker without an
// 'error' listener spins on the refusals. Every Worker gets a listener that logs at most once per
// interval and, on an out-of-memory refusal, pauses all of them for a while instead of spinning.
// The heartbeat measures memory first, alerts from this process when the store is nearly full
// (the shared alert marker is itself a write), then writes the gauge and the heartbeat key.

export const WORKER_ERROR_LOG_EVERY_MS = 10_000;
export const OOM_PAUSE_MS = 60_000;
/** Share of maxmemory from which the heartbeat alerts by itself, once an hour per process. */
export const QUEUE_FULL_SHARE = 0.95;
const FULL_ALERT_EVERY_MS = 3_600_000;

export const QUEUE_FULL_ALERT_TITLE = "Valkey (file de travaux) presque pleine : écritures bientôt refusées";

/** The largest key families a flood can grow, named in the alerts so the operator knows what to free. */
export const QUEUE_STORE_RECOVERY =
  "Familles à vérifier en premier : stats:day:* (compteurs du jour, vidés par le flush de la nuit), bull:*:completed et bull:*:failed (travaux terminés), alert:sent:*. " +
  "Libérer : UNLINK des clés stats:day:* les plus anciennes, puis vérifier used_memory (INFO memory) et que les travaux planifiés repartent.";

/** Valkey's refusal at maxmemory under noeviction ("OOM command not allowed when used memory > 'maxmemory'"). */
export function isOutOfMemory(error: unknown): boolean {
  return error instanceof Error && /\bOOM\b/.test(error.message);
}

export interface GuardedWorker {
  readonly name: string;
  on(event: "error", listener: (error: Error) => void): unknown;
  pause(doNotWaitActive?: boolean): Promise<void>;
  resume(): Promise<void> | void;
}

export interface GuardClock {
  now(): number;
  later(run: () => void, ms: number): void;
}

const realClock: GuardClock = {
  now: () => Date.now(),
  later: (run, ms) => {
    setTimeout(run, ms).unref();
  },
};

/** One 'error' listener per Worker: rate-limited log, and a shared pause on out-of-memory refusals. */
export function guardWorkers(workers: readonly GuardedWorker[], clock: GuardClock = realClock): void {
  const lastLog = new Map<string, number>();
  let pausedUntil = 0;
  for (const worker of workers) {
    worker.on("error", (error) => {
      const now = clock.now();
      if (now - (lastLog.get(worker.name) ?? -Infinity) >= WORKER_ERROR_LOG_EVERY_MS) {
        lastLog.set(worker.name, now);
        logger.error({ queue: worker.name, err: error.message }, "worker error");
      }
      if (!isOutOfMemory(error) || now < pausedUntil) return;
      pausedUntil = now + OOM_PAUSE_MS;
      logger.error({ pauseMs: OOM_PAUSE_MS }, "valkey-queue refuses writes (maxmemory): workers paused");
      for (const each of workers) void each.pause(true).catch(() => undefined);
      clock.later(() => {
        for (const each of workers) void Promise.resolve(each.resume()).catch(() => undefined);
      }, OOM_PAUSE_MS);
    });
  }
}

export interface BeatDeps {
  connection: Pick<Redis, "info" | "set">;
  setGauge(used: number): Promise<unknown>;
  touch(): Promise<void>;
  alert(event: Alert): Promise<unknown>;
  now?: () => number;
}

/** The heartbeat: memory first (alerting by itself when nearly full), then the gauge, then the key. */
export function createBeat(deps: BeatDeps): () => Promise<void> {
  const limit = QUOTAS["valkey.queueMemory"].limit;
  const now = deps.now ?? (() => Date.now());
  let lastFullAlert = -Infinity;
  return async () => {
    let used: number | null = null;
    try {
      used = usedMemoryBytes(await deps.connection.info("memory"));
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "valkey-queue memory not read");
    }
    if (used !== null && used >= limit * QUEUE_FULL_SHARE && now() - lastFullAlert >= FULL_ALERT_EVERY_MS) {
      lastFullAlert = now();
      await deps
        .alert({
          severity: "P1",
          title: QUEUE_FULL_ALERT_TITLE,
          body: `used_memory ${Math.round(used / 1_048_576)} MiB sur ${Math.round(limit / 1_048_576)} MiB (noeviction) : à 100 %, travaux, compteurs de quotas et heartbeat sont refusés. ${QUEUE_STORE_RECOVERY}`,
        })
        .catch(() => undefined);
    }
    if (used !== null) {
      try {
        await deps.setGauge(used);
      } catch (error) {
        logger.warn({ err: (error as Error).message }, "valkey-queue memory gauge not written");
      }
    }
    try {
      await deps.connection.set(WORKER_HEARTBEAT_KEY, new Date(now()).toISOString(), "EX", WORKER_HEARTBEAT_TTL);
      await deps.touch().catch(() => undefined);
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "heartbeat failed");
    }
  };
}
