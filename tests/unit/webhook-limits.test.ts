import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Per-IP ceiling of the provider webhooks (security review D-1): checked before the body is read,
// on every webhook route, under the open policy. Memory limiter (no RATE_LIMIT_REDIS_URL).

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));

const { RATE_LIMITS } = await import("@/config/rate-limits");
const { resetServerEnv } = await import("@/lib/env");
const { consumeLimit, resetRateLimiters } = await import("@/lib/rate-limit/limiter");
const routes = {
  mail: await import("@/app/api/webhooks/mail/route"),
  revenuecat: await import("@/app/api/webhooks/revenuecat/route"),
  stripe: await import("@/app/api/webhooks/stripe/route"),
  whatsapp: await import("@/app/api/webhooks/whatsapp/route"),
};

const context = { params: Promise.resolve({}) };
type Handler = (request: NextRequest, ctx: typeof context) => Promise<Response>;

/** A POST whose body stream counts its reads (highWaterMark 0: nothing is pulled until a read). */
function post(name: string, ip: string): { request: Request; pulls: () => number } {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const request = new Request(`https://aalan.test/api/webhooks/${name}`, { method: "POST", headers: { "x-forwarded-for": ip }, body, duplex: "half" } as RequestInit);
  return { request, pulls: () => pulls };
}

const UNSET = ["APP_ENV", "RATE_LIMIT_REDIS_URL", "MAIL_WEBHOOK_SECRET", "REVENUECAT_WEBHOOK_AUTH", "REVENUECAT_WEBHOOK_HMAC_SECRET", "STRIPE_WEBHOOK_SECRET", "WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN"];
const saved = { ...process.env };

beforeEach(() => {
  for (const key of UNSET) delete process.env[key];
  resetServerEnv();
  resetRateLimiters();
});

afterEach(() => {
  process.env = { ...saved };
  resetServerEnv();
  resetRateLimiters();
});

describe("webhook.ip", () => {
  it("is generous, per IP and open: a Valkey outage never drops a provider event", () => {
    expect(RATE_LIMITS["webhook.ip"]).toEqual({ points: 120, duration: 60, policy: "open", key: "ip" });
  });

  it.each(Object.keys(routes) as (keyof typeof routes)[])("refuses /api/webhooks/%s with 429 past the ceiling, before reading the body", async (name) => {
    const ip = "203.0.113.7";
    // Exhaust this IP's allowance (shared by every webhook route).
    await consumeLimit("webhook.ip", ip, RATE_LIMITS["webhook.ip"].points);
    const { request, pulls } = post(name, ip);
    const response = await (routes[name].POST as Handler)(request as NextRequest, context);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(pulls()).toBe(0);

    // Another IP is not affected (here the route stops at its unset secret: 503).
    const other = post(name, "198.51.100.9");
    expect((await (routes[name].POST as Handler)(other.request as NextRequest, context)).status).toBe(503);
  });

  it("counts the WhatsApp subscription handshake too (verify-token guesses)", async () => {
    const ip = "203.0.113.8";
    await consumeLimit("webhook.ip", ip, RATE_LIMITS["webhook.ip"].points);
    const request = new Request("https://aalan.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1", { headers: { "x-forwarded-for": ip } });
    expect((await (routes.whatsapp.GET as Handler)(request as NextRequest, context)).status).toBe(429);
  });
});
