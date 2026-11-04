// Search-only load test of staging (audit lot 7; docs/lancement/charge-procedure.md, « Recherche
// seule »). The k6 run mixes its search phase with the tail of the pages phase (n° 4 to 6: p95 917 ms
// to 1.5 s for a 119 to 159 ms median), so this generator sends /api/search alone, from the staging
// worker container to the web container on the Compose network (no Cloudflare, no tunnel: what the
// origin answers), at a constant arrival rate:
//
//   docker exec -d <worker> sh -c 'node dist/worker/load-search.mjs --rate=50 --seconds=180 > /tmp/load-search.json'
//
// Queries: the load test data set's (src/lib/loadtest/data.ts, `seed-loadtest.mjs --index-only`).
// Each request carries its own `cf-connecting-ip` from the benchmarking range 198.18.0.0/15 and no
// device cookie, as many visitors would: the per-device and per-IP limiters run (one Valkey round
// trip) and never trip. Staging only (APP_ENV). Prints one JSON summary: latencies, statuses, the
// rate reached and the p95 of every 10 seconds.

import { parseArgs } from "node:util";
import { loadtestSearchQueries } from "@/lib/loadtest/data";

export interface LoadArgs {
  rate: number;
  seconds: number;
  target: string;
  /** Requests in flight at most; beyond it a tick is dropped (counted). */
  maxInFlight: number;
  timeoutMs: number;
}

export function parseLoadCli(argv: readonly string[]): LoadArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: { rate: { type: "string", default: "50" }, seconds: { type: "string", default: "180" }, target: { type: "string", default: "http://web:3000" }, "max-in-flight": { type: "string", default: "300" }, "timeout-ms": { type: "string", default: "30000" } },
    strict: true,
  });
  const int = (value: string | undefined, min: number, max: number, name: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
    return n;
  };
  const target = values.target ?? "";
  if (!/^http:\/\/[a-z0-9.-]+(?::\d+)?$/.test(target)) throw new Error("--target must be http://<host>[:port] on the Compose network");
  return { rate: int(values.rate, 1, 200, "rate"), seconds: int(values.seconds, 1, 600, "seconds"), target, maxInFlight: int(values["max-in-flight"], 1, 1000, "max-in-flight"), timeoutMs: int(values["timeout-ms"], 1000, 60000, "timeout-ms") };
}

/** Nearest-rank percentile of sorted values (0 when empty). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

/** Address `n` of 198.18.0.0/15 (RFC 2544 benchmarking): distinct for 131 072 requests. */
export function benchmarkIp(n: number): string {
  const host = n % 131_072;
  return `198.${18 + (host >> 16)}.${(host >> 8) & 255}.${host & 255}`;
}

export interface Sample {
  /** Seconds since the start, when sent. */
  at: number;
  ms: number;
  status: number;
}

/** `sendSeconds`: how long the sending took (the rate reached is over that span). */
export function summarize(samples: readonly Sample[], args: LoadArgs, dropped: number, sendSeconds: number) {
  const ok = samples.filter((sample) => sample.status === 200);
  const sorted = ok.map((sample) => sample.ms).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const sample of samples) statuses[String(sample.status)] = (statuses[String(sample.status)] ?? 0) + 1;
  const windows: number[] = [];
  for (let start = 0; start < args.seconds; start += 10) {
    windows.push(Math.round(percentile(ok.filter((sample) => sample.at >= start && sample.at < start + 10).map((sample) => sample.ms).sort((a, b) => a - b), 95)));
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    asked: { rate: args.rate, seconds: args.seconds },
    sent: samples.length,
    dropped,
    reachedRate: round(samples.length / Math.max(1, sendSeconds)),
    failedRate: round((100 * (samples.length - ok.length)) / Math.max(1, samples.length)) / 100,
    statuses,
    ms: { min: round(sorted[0] ?? 0), p50: round(percentile(sorted, 50)), p90: round(percentile(sorted, 90)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted.at(-1) ?? 0) },
    p95Every10s: windows,
    thresholdP95Under300: percentile(sorted, 95) < 300,
  };
}

async function main(): Promise<void> {
  const args = parseLoadCli(process.argv.slice(2));
  if (process.env.APP_ENV !== "staging") throw new Error(`staging only (APP_ENV=${process.env.APP_ENV ?? ""})`);
  const queries = loadtestSearchQueries(args.rate * args.seconds);
  const samples: Sample[] = [];
  let inFlight = 0;
  let dropped = 0;
  let sent = 0;
  const started = performance.now();
  const total = args.rate * args.seconds;
  const pending: Promise<void>[] = [];
  const fire = (n: number) => {
    if (inFlight >= args.maxInFlight) {
      dropped += 1;
      return;
    }
    inFlight += 1;
    const at = (performance.now() - started) / 1000;
    const t0 = performance.now();
    const request = fetch(`${args.target}/api/search?${queries[n % queries.length]}`, { headers: { "cf-connecting-ip": benchmarkIp(n), "user-agent": "aalan-loadtest/search" }, redirect: "manual", signal: AbortSignal.timeout(args.timeoutMs) })
      .then(async (response) => {
        await response.arrayBuffer();
        samples.push({ at, ms: performance.now() - t0, status: response.status });
      })
      .catch(() => {
        samples.push({ at, ms: performance.now() - t0, status: 0 });
      })
      .finally(() => {
        inFlight -= 1;
      });
    pending.push(request);
  };
  // Constant arrival rate: each tick sends what the clock owes (a late timer catches up).
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const due = Math.min(total, Math.floor(((performance.now() - started) / 1000) * args.rate));
      while (sent < due) fire(sent++);
      if (sent >= total) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
  const sending = (performance.now() - started) / 1000;
  await Promise.all(pending);
  process.stdout.write(`${JSON.stringify(summarize(samples, args, dropped, sending))}\n`);
}

if (process.argv[1] && /[\\/]load-search\.(?:ts|mjs)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`load-search: ${(error as Error).message}`);
    process.exit(1);
  });
}
