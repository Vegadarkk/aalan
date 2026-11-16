import { describe, expect, it, vi } from "vitest";

// Account walks of the sanctions (design D14) on an account holding more listings than one round
// reads (SANCTION_LISTINGS_MAX): every listing is paused, resumed, removed and restored, the other
// kinds of paused listings never starve the walk, and a walk that cannot finish is alerted.

vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/queue", () => ({ enqueueAiTask: vi.fn(async () => ({ queued: false })) }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));

import { alert } from "@/lib/alert";
import { listOwnerListingsByStatus } from "@/lib/db/repositories/listings";
import { pauseListingsForSuspension, removeListingsForBan, restoreBannedListings, resumeModerationPaused, SANCTION_LISTINGS_MAX, walkOwnerListings } from "@/lib/decisions/sanctions";
import { seedListing } from "../../messaging/helpers";
import { member } from "../../listings/helpers";

const MANY = SANCTION_LISTINGS_MAX + 15;

async function count(uid: string, status: "published" | "paused" | "removed", only: Parameters<typeof listOwnerListingsByStatus>[3] = {}): Promise<number> {
  return (await listOwnerListingsByStatus(uid, [status], 10_000, only)).length;
}

describe("sanction walks over more listings than one round", () => {
  it("pause, resume, remove and restore every listing; an owner's own pause is never resumed", { timeout: 300_000 }, async () => {
    const seller = await member();
    await Promise.all(Array.from({ length: MANY }, () => seedListing(seller)));
    // Owner-paused listings first in no particular order: they must not take a round's places.
    await Promise.all(Array.from({ length: 5 }, () => seedListing(seller, { status: "paused", pausedReason: "owner" })));
    const now = new Date();

    expect(await pauseListingsForSuspension(seller.uid, now)).toHaveLength(MANY);
    expect(await count(seller.uid, "published")).toBe(0);
    expect(await count(seller.uid, "paused", { pausedReason: "moderation" })).toBe(MANY);

    expect(await resumeModerationPaused(seller.uid, now)).toHaveLength(MANY);
    expect(await count(seller.uid, "published")).toBe(MANY);
    expect(await count(seller.uid, "paused", { pausedReason: "owner" })).toBe(5);

    expect(await removeListingsForBan(seller.uid, "ban-decision", "admin-uid", now)).toHaveLength(MANY + 5);
    expect(await count(seller.uid, "removed", { lastDecisionId: "ban-decision" })).toBe(MANY + 5);

    expect(await restoreBannedListings(seller.uid, "ban-decision", "admin-uid", now)).toHaveLength(MANY + 5);
    expect(await count(seller.uid, "removed")).toBe(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it("alerts when listings are left after the walk", async () => {
    const seller = await member();
    await seedListing(seller);
    // A walk whose change never applies leaves the listing published.
    const changed = await walkOwnerListings(seller.uid, ["published"], {}, () => null, new Date(), "test walk");
    expect(changed).toHaveLength(0);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ severity: "P1", title: expect.stringContaining(seller.uid) as string }));
  });
});
