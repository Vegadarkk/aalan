import { describe, expect, it } from "vitest";
import { benchmarkIp, parseLoadCli, percentile, summarize, type Sample } from "../../scripts/load-search";

// Search-only load generator (audit lot 7): flags, percentiles, addresses and the summary.

describe("load-search", () => {
  it("parses its flags with safe bounds", () => {
    expect(parseLoadCli([])).toEqual({ rate: 50, seconds: 180, target: "http://web:3000", maxInFlight: 300, timeoutMs: 30000 });
    expect(parseLoadCli(["--rate=20", "--seconds=60"])).toMatchObject({ rate: 20, seconds: 60 });
    expect(() => parseLoadCli(["--rate=0"])).toThrow();
    expect(() => parseLoadCli(["--rate=500"])).toThrow();
    expect(() => parseLoadCli(["--target=https://staging.aalan.ma"])).toThrow();
    expect(() => parseLoadCli(["--other"])).toThrow();
  });

  it("takes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, n) => n + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 100)).toBe(100);
    expect(percentile([], 95)).toBe(0);
  });

  it("spreads requests over the benchmarking range", () => {
    expect(benchmarkIp(0)).toBe("198.18.0.0");
    expect(benchmarkIp(257)).toBe("198.18.1.1");
    expect(benchmarkIp(65_536)).toBe("198.19.0.0");
    expect(new Set(Array.from({ length: 9_000 }, (_, n) => benchmarkIp(n))).size).toBe(9_000);
  });

  it("summarizes successes, failures and the p95 of each 10 seconds", () => {
    const samples: Sample[] = [
      ...Array.from({ length: 95 }, (_, n) => ({ at: n / 10, ms: 20, status: 200 })),
      ...Array.from({ length: 5 }, (_, n) => ({ at: 15 + n, ms: 400, status: 200 })),
      { at: 19, ms: 5, status: 503 },
    ];
    const summary = summarize(samples, { rate: 5, seconds: 20, target: "http://web:3000", maxInFlight: 10, timeoutMs: 1000 }, 2, 20);
    expect(summary.sent).toBe(101);
    expect(summary.dropped).toBe(2);
    expect(summary.statuses).toEqual({ "200": 100, "503": 1 });
    expect(summary.ms.p50).toBe(20);
    expect(summary.ms.max).toBe(400);
    expect(summary.p95Every10s).toEqual([20, 400]);
    expect(summary.thresholdP95Under300).toBe(true);
  });
});
