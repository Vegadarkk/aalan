import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/config/rate-limits";

// Anonymous IP-keyed limiters in front of Firestore reads or shared quotas have an IPv6 /48
// sibling: rotating /64 prefixes of one allocation does not give a fresh allowance each time.

describe("anonymous /48 limiters", () => {
  it("pairs each anonymous read family with a wider /48 counter", () => {
    for (const [ip, ip48] of [
      ["review.read.ip", "review.read.ip48"],
      ["shop.payment.ip", "shop.payment.ip48"],
      ["stats.view.ip", "stats.view.ip48"],
    ] as const) {
      expect(RATE_LIMITS[ip].key).toBe("ip");
      expect(RATE_LIMITS[ip48].key).toBe("ip48");
      expect(RATE_LIMITS[ip48].duration).toBe(RATE_LIMITS[ip].duration);
      expect(RATE_LIMITS[ip48].points).toBeGreaterThan(RATE_LIMITS[ip].points);
    }
  });
});
