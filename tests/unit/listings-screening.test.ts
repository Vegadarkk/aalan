import { describe, expect, it } from "vitest";
import type { ListingDoc } from "@/lib/db/schemas";
import { screeningChange } from "@/lib/listings/screening-change";
import { contentFingerprint, detectDuplicates, screen, sellerFacts, type PhotoLookalike } from "@/lib/listings/screening";

// Adapter between a listing document and the moderation core: the seller facts (a reopened
// listing's own rejection counts) and the fields handed to the screen (the district included).

const NOW = new Date("2026-10-16T10:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function listing(overrides: Partial<ListingDoc> = {}): ListingDoc {
  return {
    ownerUid: "uid-screening",
    sellerType: "individual",
    sellerName: "Salma",
    sellerPublicId: "abcd2345",
    status: "draft",
    title: "Vélo de ville Peugeot en bon état",
    description: "Vélo de ville 28 pouces, 6 vitesses, révisé récemment, deux pneus neufs. Remise en main propre.",
    categoryId: "vehicules",
    subcategoryId: "velos",
    attributes: { "bike-type": "ville", brand: "Peugeot" },
    condition: "good",
    price: 1500,
    priceNegotiable: false,
    isDonation: false,
    location: { regionCode: "06", citySlug: "casablanca", geo: { lat: 33.57, lng: -7.59 } },
    photos: [],
    contact: { messaging: true, showPhone: false, whatsapp: false },
    boosts: {},
    sortAt: NOW,
    sortSource: "publish",
    moderation: { state: "auto_ok", score: 0, flags: [], openReports: 0 },
    adsEligible: false,
    legalHold: [],
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  } as ListingDoc;
}

const seller = { accountAgeDays: 30, listingsLast24h: 0, phoneVerified: false, previousRejections: 0 };

describe("sellerFacts", () => {
  it("counts the other rejected listings, plus the listing itself when a moderator rejected it", () => {
    const others = [
      { status: "rejected" as const, createdAt: new Date(NOW.getTime() - 10 * DAY_MS) },
      { status: "published" as const, createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) },
    ];
    const base = { accountCreatedAt: new Date(NOW.getTime() - 40 * DAY_MS), phoneVerified: true, others, now: NOW };
    expect(sellerFacts(base)).toEqual({ accountAgeDays: 40, listingsLast24h: 1, phoneVerified: true, previousRejections: 1, sanitaryNumbers: [] });
    expect(sellerFacts({ ...base, selfRejected: true }).previousRejections).toBe(2);
    expect(sellerFacts({ ...base, others: [], selfRejected: false }).previousRejections).toBe(0);
  });
});

describe("screen", () => {
  it("hands the district to the core: a phone number there blocks, a plain district passes", async () => {
    const located = (district: string) => listing({ location: { regionCode: "06", citySlug: "casablanca", district, geo: { lat: 33.57, lng: -7.59 } } });
    const blocked = await screen({ listing: located("Maarif 06 12 34 56 78"), uploads: [], seller, others: [] });
    expect(blocked.blockers).toEqual([{ path: "location.district", code: "phone_in_text" }]);
    const clean = await screen({ listing: located("Maarif"), uploads: [], seller, others: [] });
    expect(clean).toMatchObject({ state: "auto_ok", blockers: [], flags: [] });
    expect((await screen({ listing: listing(), uploads: [], seller, others: [] })).blockers).toEqual([]);
  });

  it("scores the previous rejections the facts carry", async () => {
    const result = await screen({ listing: listing(), uploads: [], seller: { ...seller, previousRejections: 1 }, others: [] });
    expect(result).toMatchObject({ state: "auto_ok", score: 10 });
    expect(result.evidence).toContain("1 previous rejection(s)");
  });
});

describe("detectDuplicates (zone 7 P4 Photo en double)", () => {
  const HASH = "0123456789abcdef";
  // 5 bits off: a re-encoded or resized copy; 12 bits off: another picture.
  const NEAR = "0123456789abcdf0";
  const FAR = "0123456789a54321";
  const photo = (id: string, hash?: string) => ({ id, w: 800, h: 600, blurhash: "LEHV6nWB2yk8", ...(hash ? { hash } : {}) }) as ListingDoc["photos"][number];
  const mine = listing({ photos: [photo("up_a", HASH)] });
  const other = (id: string, hash: string | undefined, text = "Autre annonce") => ({ id, title: text, description: text, photos: [photo(`up_${id}`, hash)] });

  it("counts the owner's listings with a near-duplicate photo, not a different or flat one", () => {
    expect(detectDuplicates(mine, [other("l1", NEAR), other("l2", FAR), other("l3", undefined)], "self")).toEqual({ sameText: 0, samePhoto: 1 });
    expect(detectDuplicates(mine, [other("self", HASH)], "self").samePhoto).toBe(0);
    const flat = listing({ photos: [photo("up_f", "0000000000000000")] });
    expect(detectDuplicates(flat, [other("l4", "0000000000000000")]).samePhoto).toBe(0);
  });

  it("counts other accounts' listings with a near-duplicate photo, quoting 3 of them, never the owner's own or drafts", () => {
    const lookalike = (id: string, ownerUid: string, hash: string, status: PhotoLookalike["status"] = "published"): PhotoLookalike => ({ id, ownerUid, status, photos: [photo(`up_${id}`, hash)] });
    const lookalikes = [
      lookalike("x1", "uid-other", NEAR),
      lookalike("x2", "uid-other", HASH, "removed"),
      lookalike("x3", "uid-third", HASH, "expired"),
      lookalike("x4", "uid-fourth", NEAR, "rejected"),
      lookalike("x5", "uid-other", FAR),
      lookalike("x6", "uid-other", HASH, "draft"),
      lookalike("x7", mine.ownerUid, HASH),
      lookalike("self", "uid-other", HASH),
    ];
    expect(detectDuplicates(mine, [], "self", lookalikes)).toEqual({ sameText: 0, samePhoto: 0, otherAccountPhoto: 4, otherAccountListings: ["x1", "x2", "x3"] });
    expect(detectDuplicates(mine, [], "self", [lookalike("x5", "uid-other", FAR)])).toEqual({ sameText: 0, samePhoto: 0 });
  });

  it("hands the lookalikes to the core: dup_photo_other", async () => {
    const result = await screen({ listing: mine, uploads: [], seller, others: [], lookalikes: [{ id: "x1", ownerUid: "uid-other", status: "published", photos: [photo("up_x1", NEAR)] }] }, "self");
    expect(result).toMatchObject({ state: "auto_ok", score: 30, flags: ["dup_photo_other"] });
    expect(result.evidence).toContain("same photo as 1 listing(s) of other accounts: x1");
  });
});

describe("contentFingerprint", () => {
  it("moves with the text, the price and the photos, not with the other fields", () => {
    const base = listing();
    const fingerprint = contentFingerprint(base);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(contentFingerprint({ ...base, title: "  vélo de ville PEUGEOT en bon état " })).toBe(fingerprint);
    expect(contentFingerprint({ ...base, ...{ priceNegotiable: true, attributes: { "bike-type": "route" } } } as ListingDoc)).toBe(fingerprint);
    expect(contentFingerprint({ ...base, description: `${base.description} Casque offert.` })).not.toBe(fingerprint);
    expect(contentFingerprint({ ...base, price: 1200 })).not.toBe(fingerprint);
    expect(contentFingerprint({ ...base, photos: [{ id: "up_photo_added", w: 800, h: 600 }] as ListingDoc["photos"] })).not.toBe(fingerprint);
  });
});

describe("screeningChange (zone 7 P2-11)", () => {
  const stored = { score: 80, flags: ["dup_photo", "new_account"] as const };

  it("says nothing when the re-run gives the stored score and flags", () => {
    expect(screeningChange(stored, { score: 80, flags: ["new_account", "dup_photo"] }, false)).toEqual({ kind: "none" });
    expect(screeningChange(stored, null, null)).toEqual({ kind: "none" });
  });

  it("names a context-only move as a re-scored check, with the flags it added and dropped", () => {
    expect(screeningChange(stored, { score: 95, flags: ["dup_photo", "new_account", "volume"] }, false)).toEqual({ kind: "rescored", added: ["volume"], removed: [] });
    expect(screeningChange(stored, { score: 65, flags: ["dup_photo"] }, null)).toEqual({ kind: "rescored", added: [], removed: ["new_account"] });
  });

  it("speaks of a content change only when the seller changed the text, price or photos", () => {
    expect(screeningChange(stored, { score: 95, flags: ["dup_photo", "new_account", "volume"] }, true)).toEqual({ kind: "content", rescored: true });
    expect(screeningChange(stored, { score: 80, flags: ["dup_photo", "new_account"] }, true)).toEqual({ kind: "content", rescored: false });
  });
});
