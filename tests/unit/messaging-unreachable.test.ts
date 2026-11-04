import { describe, expect, it } from "vitest";
import { SELLER_UNREACHABLE } from "@/lib/listings/public";
import { UNREACHABLE_STATUSES } from "@/lib/messaging/repository";

// appendMessage refuses to deliver to these accounts (audit C-6): the same states a conversation
// cannot start with, kept as a copy in the repository (no import of the listings page graph).

describe("UNREACHABLE_STATUSES", () => {
  it("matches the seller states no conversation starts with; a restricted account still receives", () => {
    expect([...UNREACHABLE_STATUSES].sort()).toEqual([...SELLER_UNREACHABLE].sort());
    expect(UNREACHABLE_STATUSES).not.toContain("restricted");
  });
});
