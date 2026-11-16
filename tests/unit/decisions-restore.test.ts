import { describe, expect, it, vi } from "vitest";
import type { ListingRecord } from "@/lib/db/repositories/listings";
import type { AppealAccountState } from "@/lib/decisions/review-context";

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));

const { removedFromOf, restoreHold, takesSlot, unremovePatch } = await import("@/lib/decisions/sanctions");
const { appealWarnings } = await import("@/lib/decisions/review-context");

// What a reversal gives back to a listing (sanctions.ts: restoreHold, unremovePatch) and what the
// appeal review page warns about (review-context.ts: appealWarnings), from the owner's state.

const NOW = new Date("2026-11-16T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const LIFE = { ttlDays: 60, purgeMonths: 6 };

function removed(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return {
    id: "abcdefgh",
    status: "removed",
    moderation: { state: "auto_ok", flags: [] },
    publishedAt: new Date(NOW.getTime() - 5 * DAY),
    expiresAt: new Date(NOW.getTime() + 30 * DAY),
    version: 4,
    ...overrides,
  } as unknown as ListingRecord;
}

describe("restore hold", () => {
  it("follows the owner's status and the shop's lifecycle", () => {
    expect(restoreHold(null, null)).toBe("offline");
    expect(restoreHold({ status: "closed" }, null)).toBe("offline");
    expect(restoreHold({ status: "banned" }, { lifecycle: "active" })).toBe("offline");
    expect(restoreHold({ status: "active" }, { lifecycle: "revalidation_required" })).toBe("pro_revalidation");
    expect(restoreHold({ status: "suspended" }, null)).toBe("moderation");
    expect(restoreHold({ status: "restricted" }, null)).toBe("review");
    expect(restoreHold({ status: "active" }, { lifecycle: "active" })).toBe("none");
  });
});

describe("un-removal", () => {
  it("publishes a live listing only when nothing holds it", () => {
    expect(unremovePatch(removed(), NOW, LIFE)?.patch).toMatchObject({ status: "published", pausedReason: null, version: 5 });
    expect(unremovePatch(removed(), NOW, LIFE)?.search).toBe("upsert");
    expect(unremovePatch(removed(), NOW, LIFE, "offline")).toBeNull();
  });

  it("pauses it for a suspended owner or a shop in revalidation, unindexed", () => {
    for (const hold of ["moderation", "pro_revalidation"] as const) {
      const change = unremovePatch(removed(), NOW, LIFE, hold);
      expect(change?.patch).toMatchObject({ status: "paused", pausedReason: hold });
      expect(change?.search).toBeNull();
    }
  });

  it("sends a held or flagged listing, or a restricted owner's, back to review", () => {
    const flagged = unremovePatch(removed({ moderation: { state: "needs_review", flags: [] } as unknown as ListingRecord["moderation"] }), NOW, LIFE);
    expect(flagged?.patch).toMatchObject({ status: "pending_review" });
    expect(flagged?.search).toBeNull();
    expect(unremovePatch(removed(), NOW, LIFE, "review")?.patch).toMatchObject({ status: "pending_review" });
  });

  it("expires a listing whose time ran out, and reviews one never published", () => {
    expect(unremovePatch(removed({ expiresAt: new Date(NOW.getTime() - DAY) }), NOW, LIFE)?.patch).toMatchObject({ status: "expired" });
    expect(unremovePatch(removed({ publishedAt: undefined, expiresAt: undefined }), NOW, LIFE)?.patch).toMatchObject({ status: "pending_review", purgeAt: null });
  });
});

describe("what the removal replaced", () => {
  const from = (removedFrom: NonNullable<ListingRecord["moderation"]["removedFrom"]>, overrides: Partial<ListingRecord["moderation"]> = {}) =>
    removed({ moderation: { state: "auto_ok", flags: [], removedFrom, ...overrides } as unknown as ListingRecord["moderation"] });

  it("is recorded with the pause reason of a paused listing only", () => {
    expect(removedFromOf({ status: "paused", pausedReason: "owner" })).toEqual({ status: "paused", pausedReason: "owner" });
    expect(removedFromOf({ status: "sold" })).toEqual({ status: "sold" });
    expect(removedFromOf({ status: "published" })).toEqual({ status: "published" });
  });

  it("gives back a sale, an owner's or quota pause, and a held edit", () => {
    expect(unremovePatch(from({ status: "sold" }), NOW, LIFE)?.patch).toMatchObject({ status: "sold" });
    expect(unremovePatch(from({ status: "sold" }), NOW, LIFE)?.search).toBeNull();
    for (const reason of ["owner", "quota"] as const) {
      expect(unremovePatch(from({ status: "paused", pausedReason: reason }), NOW, LIFE)?.patch).toMatchObject({ status: "paused", pausedReason: reason });
    }
    // The owner's pause outlives a suspension hold (the lift resumes moderation pauses only).
    expect(unremovePatch(from({ status: "paused", pausedReason: "owner" }), NOW, LIFE, "moderation")?.patch).toMatchObject({ pausedReason: "owner" });
    // A moderation pause the removal replaced is not kept: the account's state decides.
    expect(unremovePatch(from({ status: "paused", pausedReason: "moderation" }), NOW, LIFE)?.patch).toMatchObject({ status: "published" });
    expect(unremovePatch(from({ status: "pending_review" }), NOW, LIFE)?.patch).toMatchObject({ status: "pending_review" });
    // A flagged edit of an owner-paused listing goes to review and back to the owner's pause on approval.
    expect(unremovePatch(from({ status: "paused", pausedReason: "owner" }, { state: "needs_review" }), NOW, LIFE)?.patch).toMatchObject({ status: "pending_review", pausedReason: "owner" });
  });

  it("pauses for the quota when the owner has no free slot", () => {
    const full = unremovePatch(removed(), NOW, LIFE, "none", 0);
    expect(full?.patch).toMatchObject({ status: "paused", pausedReason: "quota" });
    expect(takesSlot(full!)).toBe(false);
    expect(unremovePatch(from({ status: "pending_review" }), NOW, LIFE, "none", 0)?.patch).toMatchObject({ status: "paused", pausedReason: "quota" });
    expect(takesSlot(unremovePatch(removed(), NOW, LIFE, "none", 1)!)).toBe(true);
  });
});

describe("appeal review warnings", () => {
  const state = (overrides: Partial<AppealAccountState> = {}): AppealAccountState => ({
    status: "active",
    closed: false,
    suspendedUntil: null,
    otherSuspension: null,
    shopLifecycle: null,
    ...overrides,
  });
  const listingRemoval = { action: "remove", target: { type: "listing", id: "abcdefgh" } } as const;
  const ban = { action: "ban", target: { type: "user", id: "u1" } } as const;
  const suspension = { action: "suspend_account", target: { type: "user", id: "u1" } } as const;

  it("say nothing for an active account", () => {
    expect(appealWarnings(state(), listingRemoval)).toEqual([]);
  });

  it("name what a reversal will not give back", () => {
    expect(appealWarnings(state({ status: "missing" }), listingRemoval)[0]).toMatch(/n'existe plus/);
    expect(appealWarnings(state({ status: "closed", closed: true }), ban)).toEqual([expect.stringMatching(/Compte fermé/)]);
    expect(appealWarnings(state({ status: "banned" }), listingRemoval)[0]).toMatch(/banni/);
    expect(appealWarnings(state({ status: "suspended" }), listingRemoval)[0]).toMatch(/en pause/);
    expect(appealWarnings(state({ shopLifecycle: "revalidation_required" }), listingRemoval)[0]).toMatch(/revalidation/);
    expect(appealWarnings(state({ status: "restricted" }), listingRemoval)[0]).toMatch(/modération/);
  });

  it("show another suspension that keeps running", () => {
    const other = state({ status: "suspended", otherSuspension: { decisionId: "d2", until: new Date(NOW.getTime() + 20 * DAY) } });
    expect(appealWarnings(other, suspension)).toEqual([expect.stringMatching(/Une autre suspension court jusqu'au .+ : elle reste en vigueur\.$/)]);
    expect(appealWarnings(other, ban)[0]).toMatch(/les annonces reviennent en pause/);
  });
});
