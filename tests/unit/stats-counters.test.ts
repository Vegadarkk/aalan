import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeValkey } from "./messaging-fake-valkey";

// Shop counters (src/lib/stats/counters.ts): the day hash in the no-eviction job store stops
// taking fields at its cap (alert), and the dedupe keys never go to that store.

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));

const { alert } = await import("@/lib/alert");
const { STATS_DAY_MAX_FIELDS, STATS_DAY_FULL_ALERT_TITLE, STATS_KEYS, countContact, countView, isValidViewToken, setStatsValkeyForTests, statsDay, viewToken } = await import("@/lib/stats/counters");

const NOW = new Date("2026-11-16T12:00:00Z");

afterEach(() => {
  setStatsValkeyForTests(undefined);
  vi.mocked(alert).mockClear();
});

describe("stats counters", () => {
  it("stop adding fields to a full day hash and alert", async () => {
    const queue = new FakeValkey();
    const seen = new FakeValkey();
    setStatsValkeyForTests(queue.asClient() as never, seen.asClient() as never);
    const key = STATS_KEYS.day(statsDay(NOW));
    queue.hashes.set(key, new Map(Array.from({ length: STATS_DAY_MAX_FIELDS }, (_, i) => [`l:${String(i).padStart(8, "a")}:v`, "1"])));
    expect(await countView("l", "zzzz2345", "device-1", NOW)).toBe(true);
    await countContact({ listingId: "zzzz2346" }, NOW);
    expect(queue.hashes.get(key)?.size).toBe(STATS_DAY_MAX_FIELDS);
    expect(queue.hashes.get(key)?.has("l:zzzz2345:v")).toBe(false);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ title: STATS_DAY_FULL_ALERT_TITLE }));
  });

  it("count below the cap, once per visitor and day, with the dedupe key outside the job store", async () => {
    const queue = new FakeValkey();
    const seen = new FakeValkey();
    setStatsValkeyForTests(queue.asClient() as never, seen.asClient() as never);
    expect(await countView("s", "abcd2345", "device-1", NOW)).toBe(true);
    expect(await countView("s", "abcd2345", "device-1", NOW)).toBe(false);
    expect(queue.hashes.get(STATS_KEYS.day(statsDay(NOW)))?.get("s:abcd2345:v")).toBe("1");
    expect(queue.strings.size).toBe(0);
    expect(seen.strings.size).toBe(1);
    // Without the rate-limit store, nothing is counted (never falls back to the job store).
    setStatsValkeyForTests(queue.asClient() as never, null);
    expect(await countView("s", "abcd2346", "device-1", NOW)).toBe(false);
    expect(queue.strings.size).toBe(0);
  });

  it("sign ids per scope", () => {
    const token = viewToken("l", "zzzz2345");
    expect(isValidViewToken("l", "zzzz2345", token)).toBe(true);
    expect(isValidViewToken("s", "zzzz2345", token)).toBe(false);
    expect(isValidViewToken("l", "zzzz2346", token)).toBe(false);
    expect(isValidViewToken("l", "zzzz2345", undefined)).toBe(false);
    expect(isValidViewToken("l", "zzzz2345", "")).toBe(false);
  });
});
