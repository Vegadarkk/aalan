import { describe, expect, it } from "vitest";
import type { ListingFieldPatch } from "@/lib/db/repositories/listings";
import type { ListingDoc } from "@/lib/db/schemas";
import { AGENT_SCREENED_STATUSES, SCREENED_FIELDS, changesScreenedContent, contentFrozen } from "@/lib/listings/edit-guard";

// The edit guard of patchListing (audit C-1, C-2): which saves change what the screens read, when
// a listing's content is frozen for review, and after which edits the agent screens again.

const MODERATION: ListingDoc["moderation"] = { state: "auto_ok", score: 0, flags: [], openReports: 0 };
const VARIANTS = {
  axes: [{ id: "size", label: "Taille", values: ["S", "M"] }],
  items: [
    { key: "S", price: 100, stock: 3 },
    { key: "M", price: 120, stock: 1 },
  ],
} as unknown as NonNullable<ListingDoc["variants"]>;

describe("changesScreenedContent", () => {
  it("is true for every field the pre-moderation reads", () => {
    for (const field of SCREENED_FIELDS) {
      expect(changesScreenedContent({ variants: undefined }, { [field]: field === "price" ? null : "x" } as ListingFieldPatch), field).toBe(true);
    }
  });

  it("is false for fields the screens do not read (section, stock alone, purge clock)", () => {
    expect(changesScreenedContent({ variants: undefined }, { sectionId: "s1", purgeAt: new Date() } as ListingFieldPatch)).toBe(false);
    const restocked = { ...VARIANTS, items: VARIANTS.items.map((item) => ({ ...item, stock: 9 })) };
    expect(changesScreenedContent({ variants: VARIANTS }, { variants: restocked })).toBe(false);
  });

  it("is true when a combination's axes or prices change", () => {
    const repriced = { ...VARIANTS, items: VARIANTS.items.map((item) => ({ ...item, price: (item.price ?? 0) + 10 })) };
    expect(changesScreenedContent({ variants: VARIANTS }, { variants: repriced })).toBe(true);
    expect(changesScreenedContent({ variants: VARIANTS }, { variants: null })).toBe(true);
    expect(changesScreenedContent({ variants: undefined }, { variants: VARIANTS })).toBe(true);
  });
});

describe("contentFrozen", () => {
  it("freezes a listing under any legal hold or with an open report", () => {
    expect(contentFrozen({ legalHold: [], moderation: MODERATION })).toBe(false);
    for (const hold of ["report:r1", "authority:a1", "appeal:p1"]) expect(contentFrozen({ legalHold: [hold], moderation: MODERATION }), hold).toBe(true);
    expect(contentFrozen({ legalHold: [], moderation: { ...MODERATION, openReports: 1 } })).toBe(true);
  });
});

describe("AGENT_SCREENED_STATUSES", () => {
  it("lists the statuses the agent acts on (src/lib/ai/apply.ts), never a paused or expired listing", () => {
    expect([...AGENT_SCREENED_STATUSES].sort()).toEqual(["pending_review", "published"]);
  });
});
