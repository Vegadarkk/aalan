import { readCapped } from "@/lib/http/body";
import { logger } from "@/lib/logging/logger";
import { requestIdentity } from "@/lib/rate-limit/keys";
import { consumeLimit } from "@/lib/rate-limit/limiter";

// CSP violation reports (report-uri and Reporting API). Logged, sampled, never stored. Each IP
// bucket gets `csp.report.ip` before the per-process sample (security review D-7), so one client
// cannot fill the sample window; only short strings and finite numbers reach the log.
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024;
const PER_MINUTE = 60;
let window = { start: 0, count: 0 };

function sample(): boolean {
  const now = Date.now();
  if (now - window.start > 60_000) window = { start: now, count: 0 };
  window.count += 1;
  return window.count <= PER_MINUTE;
}

/** A short string field (directive, disposition), else undefined. */
function short(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 200) : undefined;
}

/** A line number, else undefined. */
function line(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function path(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).pathname;
  } catch {
    return value.slice(0, 200);
  }
}

/** Scheme, host and path, never the query: tells our chunks from a CDN or a browser extension. */
function location(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 200);
  } catch {
    // Keywords such as "eval", "inline" or "wasm-eval".
    return value.slice(0, 200);
  }
}

export async function POST(request: Request): Promise<Response> {
  // Open policy: a Valkey outage leaves only the per-process sample.
  const limit = await consumeLimit("csp.report.ip", requestIdentity(request.headers).ipBucket);
  if (!limit.ok && limit.reason === "limited") return new Response(null, { status: 429, headers: { "Retry-After": String(Math.max(1, limit.retryAfterSeconds)) } });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) return new Response(null, { status: 413 });
  // Chunked bodies carry no Content-Length: the read itself is capped.
  const text = await readCapped(request.body, MAX_BYTES);
  if (text === null) return new Response(null, { status: 413 });
  if (sample()) {
    try {
      const payload: unknown = JSON.parse(text);
      const reports = Array.isArray(payload) ? payload.map((entry) => (entry as { body?: unknown }).body) : [(payload as { "csp-report"?: unknown })["csp-report"]];
      for (const report of reports.slice(0, 5)) {
        const r = (report ?? {}) as Record<string, unknown>;
        logger.warn(
          {
            csp: {
              directive: short(r["effectiveDirective"] ?? r["effective-directive"] ?? r["violated-directive"]),
              blocked: location(r["blockedURL"] ?? r["blocked-uri"]),
              source: location(r["sourceFile"] ?? r["source-file"]),
              line: line(r["lineNumber"] ?? r["line-number"]),
              page: path(r["documentURL"] ?? r["document-uri"]),
              disposition: short(r["disposition"]),
            },
          },
          "csp violation",
        );
      }
    } catch {
      // Malformed report: ignored.
    }
  }
  return new Response(null, { status: 204 });
}
