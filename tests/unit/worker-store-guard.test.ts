import { describe, expect, it, vi } from "vitest";

// The worker against a full valkey-queue (src/worker/store-guard.ts): every Worker has an 'error'
// listener that logs at most once per interval and pauses all Workers on an out-of-memory refusal;
// the heartbeat measures memory before any write and alerts by itself when the store is nearly full.

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));

const { logger } = await import("@/lib/logging/logger");
const { QUOTAS } = await import("@/config/quotas");
const { WORKER_HEARTBEAT_KEY } = await import("@/lib/health");
const guard = await import("@/worker/store-guard");

class FakeWorker {
  listeners: ((error: Error) => void)[] = [];
  paused = 0;
  resumed = 0;
  constructor(readonly name: string) {}
  on(_event: "error", listener: (error: Error) => void) {
    this.listeners.push(listener);
    return this;
  }
  async pause() {
    this.paused += 1;
  }
  resume() {
    this.resumed += 1;
  }
  emit(error: Error) {
    for (const listener of this.listeners) listener(error);
  }
}

const OOM = new Error("OOM command not allowed when used memory > 'maxmemory'.");

describe("worker error listeners", () => {
  it("are registered on every Worker, rate-limit their log, and pause everything on OOM until the timer", () => {
    let now = 1_000_000;
    const timers: (() => void)[] = [];
    const workers = [new FakeWorker("media"), new FakeWorker("mail")];
    guard.guardWorkers(workers, { now: () => now, later: (run) => void timers.push(run) });
    expect(workers.every((worker) => worker.listeners.length === 1)).toBe(true);

    vi.mocked(logger.error).mockClear();
    for (let i = 0; i < 50; i++) workers[0]!.emit(new Error("connection reset"));
    expect(vi.mocked(logger.error).mock.calls.filter(([, message]) => message === "worker error")).toHaveLength(1);
    expect(workers.every((worker) => worker.paused === 0)).toBe(true);

    workers[1]!.emit(OOM);
    workers[0]!.emit(OOM);
    expect(workers.map((worker) => worker.paused)).toEqual([1, 1]);
    expect(timers).toHaveLength(1);
    timers[0]!();
    expect(workers.map((worker) => worker.resumed)).toEqual([1, 1]);

    now += guard.OOM_PAUSE_MS + 1;
    workers[0]!.emit(OOM);
    expect(workers.map((worker) => worker.paused)).toEqual([2, 2]);
  });

  it("recognise the store's out-of-memory refusal only", () => {
    expect(guard.isOutOfMemory(OOM)).toBe(true);
    expect(guard.isOutOfMemory(new Error("ECONNREFUSED"))).toBe(false);
    expect(guard.isOutOfMemory("OOM")).toBe(false);
  });
});

describe("heartbeat", () => {
  const limit = QUOTAS["valkey.queueMemory"].limit;
  const info = (used: number) => `# Memory\r\nused_memory:${used}\r\nused_memory_human:x\r\n`;

  it("alerts once an hour from the process when nearly full, even when every write is refused", async () => {
    let now = 5_000_000;
    const order: string[] = [];
    const alert = vi.fn(async () => true);
    const beat = guard.createBeat({
      connection: {
        info: vi.fn(async () => {
          order.push("info");
          return info(Math.ceil(limit * 0.99));
        }),
        set: vi.fn(async () => {
          order.push("set");
          throw new Error("OOM command not allowed when used memory > 'maxmemory'.");
        }),
      } as never,
      setGauge: vi.fn(async () => {
        order.push("gauge");
        throw new Error("OOM command not allowed when used memory > 'maxmemory'.");
      }),
      touch: vi.fn(async () => undefined),
      alert,
      now: () => now,
    });
    await beat();
    expect(order).toEqual(["info", "gauge", "set"]);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ title: guard.QUEUE_FULL_ALERT_TITLE, body: expect.stringContaining("stats:day:") }));
    await beat();
    expect(alert).toHaveBeenCalledTimes(1);
    now += 3_600_000;
    await beat();
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("writes the gauge and the heartbeat, and touches the file, when there is room", async () => {
    const set = vi.fn(async () => "OK");
    const setGauge = vi.fn(async () => undefined);
    const touch = vi.fn(async () => undefined);
    const alert = vi.fn(async () => true);
    await guard.createBeat({ connection: { info: async () => info(10 * 1_048_576), set } as never, setGauge, touch, alert })();
    expect(setGauge).toHaveBeenCalledWith(10 * 1_048_576);
    expect(set).toHaveBeenCalledWith(WORKER_HEARTBEAT_KEY, expect.any(String), "EX", expect.any(Number));
    expect(touch).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
});
