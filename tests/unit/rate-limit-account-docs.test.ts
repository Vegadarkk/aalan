import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT_DOCUMENT_BUDGETS, RATE_LIMITS } from "@/config/rate-limits";
import { resetServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http/errors";
import { consumeLimit, consumedPoints, enforceLimit, resetRateLimiters } from "@/lib/rate-limit/limiter";

// One ceiling across every per-account daily document budget of the reads (in-memory backend):
// each family stays within its own day, and all of them together within account.docs.day.uid.

beforeEach(() => {
  delete process.env.RATE_LIMIT_REDIS_URL;
  resetServerEnv();
  resetRateLimiters();
});

describe("account.docs.day.uid", () => {
  it("is a daily per-account ceiling below the sum of the families and well below the Spark day", () => {
    expect(RATE_LIMITS["account.docs.day.uid"]).toEqual({ points: 8000, duration: 86_400, policy: "open", key: "uid" });
    const families = [...ACCOUNT_DOCUMENT_BUDGETS].map((id) => RATE_LIMITS[id]);
    expect(families.every((family) => family.duration === 86_400 && family.key === "uid" && family.policy === "open")).toBe(true);
    expect(families.reduce((sum, family) => sum + family.points, 0)).toBeGreaterThan(8000);
    // Six accounts at the ceiling stay under the 50 000 reads of the Spark day.
    expect(6 * 8000).toBeLessThan(50_000);
  });

  it("is charged with every family, and refuses once the families together reach it", async () => {
    await enforceLimit("listing.owner.read.uid", "u1", 4000);
    await enforceLimit("conversation.docs.uid", "u1", 3000);
    expect(await consumedPoints("account.docs.day.uid", "u1")).toBe(7000);
    await enforceLimit("member.docs.uid", "u1", 1000);
    // Each family still has room; the ceiling has none.
    const refused = await enforceLimit("favorites.docs.uid", "u1", 1).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).status).toBe(429);
    const outcome = await consumeLimit("wallet.read.uid", "u1", 1);
    expect(outcome).toMatchObject({ ok: false, reason: "limited" });
    // Another account is untouched.
    await expect(enforceLimit("favorites.docs.uid", "u2", 1)).resolves.toBeUndefined();
  });

  it("is not charged by other limiters, nor by a family that refuses on its own", async () => {
    await enforceLimit("member.read.uid", "u3");
    await enforceLimit("tutorials.uid", "u3");
    expect(await consumedPoints("account.docs.day.uid", "u3")).toBe(0);
    await consumeLimit("savedSearch.docs.uid", "u3", 1000);
    expect(await consumeLimit("savedSearch.docs.uid", "u3", 1)).toMatchObject({ ok: false });
    expect(await consumedPoints("account.docs.day.uid", "u3")).toBe(1000);
  });
});
