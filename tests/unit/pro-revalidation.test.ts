import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "@/config/pricing";
import { proWithdrawSchema } from "@/lib/contracts/pro";
import type { ProProfileRecord } from "@/lib/db/repositories/pro-profiles";
import { HttpError } from "@/lib/http/errors";
import { proProfileSchema, type ProProfileDoc } from "@/lib/pro/profile-schema";
import { decidedProfile } from "@/lib/pro/review";
import { withdrawnProfile } from "@/lib/pro/revalidation";
import { awaitsRevalidation, canResubmit, revalidationSubmission } from "@/lib/pro/service";

// Validation withdrawn (zone 7 audit P2-10, owner decision 2026-11-04): the profile after an
// admin's withdrawal, the new KYBC sent from the Pro space, and the review that restores the shop.

const VERIFIED_AT = new Date("2026-10-16T09:00:00.000Z");
const NOW = new Date("2026-11-04T10:00:00.000Z");
const RESENT = new Date("2026-11-05T08:00:00.000Z");
const STAFF = { at: NOW, by: "uid-admin", byName: "Admin Aalan" };
const input = { statement: "Le registre du commerce indique une radiation de la société.", note: "Radiation vue sur l'OMPIC le 4 novembre.", lifecycle: "verified" as const };

function shop(extra: Partial<ProProfileRecord> = {}): ProProfileRecord {
  return {
    proId: "abcdefgh",
    ownerUid: "uid-owner",
    members: { "uid-owner": "owner" },
    name: "Atlas Auto",
    slug: "atlas-auto-casablanca",
    description: "Concession.",
    whatsapp: false,
    regionCode: "06",
    citySlug: "casablanca",
    legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" },
    kybc: { status: "verified", iceFormatOk: true, uploadIds: ["up1"], submittedAt: VERIFIED_AT, registryCheck: { source: "ompic", at: VERIFIED_AT, by: "uid-moderator" } },
    sector: "dealer",
    sections: [{ id: "neuf01", name: "Neuf" }],
    lifecycle: "verified",
    plan: "essentiel",
    planSource: "launch_offer",
    quotas: DEFAULT_PRICING.pro.essentiel,
    createdAt: VERIFIED_AT,
    updatedAt: VERIFIED_AT,
    ...extra,
  };
}

function conflict(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
    return;
  }
  throw new Error("expected a 409");
}

describe("withdrawnProfile", () => {
  it("sends the shop to a new review, keeps its plan and settings, and notes the withdrawal", () => {
    const next = withdrawnProfile(shop(), input, STAFF);
    expect(next).toMatchObject({ lifecycle: "revalidation_required", revalidationFrom: "verified", plan: "essentiel", planSource: "launch_offer", quotas: DEFAULT_PRICING.pro.essentiel, sector: "dealer", updatedAt: NOW });
    expect(next.sections).toEqual([{ id: "neuf01", name: "Neuf" }]);
    expect(next.kybc).toMatchObject({ status: "withdrawn", withdrawnAt: NOW, withdrawReason: input.statement, registryCheck: { source: "ompic" } });
    expect(next.staffNotes?.[0]).toEqual({ ...STAFF, text: `Validation retirée, nouvelle vérification demandée. ${input.note}` });
    expect(next).not.toHaveProperty("proId");
    expect(proProfileSchema.safeParse(next).success).toBe(true);
  });

  it("keeps a subscription's plan as it is (no money moved)", () => {
    const next = withdrawnProfile(shop({ lifecycle: "active", plan: "business", planSource: "subscription", quotas: DEFAULT_PRICING.pro.business }), { ...input, lifecycle: "active" }, STAFF);
    expect(next).toMatchObject({ plan: "business", planSource: "subscription", quotas: DEFAULT_PRICING.pro.business, revalidationFrom: "active" });
  });

  it("refuses a shop not in the state the page showed, not validated, suspended or already withdrawn (409)", () => {
    conflict(() => withdrawnProfile(shop({ lifecycle: "active" }), input, STAFF));
    conflict(() => withdrawnProfile(shop({ lifecycle: "pending_verification", kybc: { ...shop().kybc, status: "submitted" } }), input, STAFF));
    conflict(() => withdrawnProfile(shop({ lifecycle: "suspended", suspendedFrom: "verified" }), input, STAFF));
    conflict(() => withdrawnProfile(withdrawnProfile(shop(), input, STAFF) as ProProfileRecord, input, STAFF));
  });

  it("needs a statement for the Pro and an internal note", () => {
    expect(proWithdrawSchema.safeParse(input).success).toBe(true);
    expect(proWithdrawSchema.safeParse({ ...input, statement: "Trop court" }).success).toBe(false);
    expect(proWithdrawSchema.safeParse({ ...input, note: "" }).success).toBe(false);
    expect(proWithdrawSchema.safeParse({ ...input, lifecycle: "suspended" }).success).toBe(false);
  });
});

describe("the new KYBC of a withdrawn shop", () => {
  const withdrawn = () => ({ proId: "abcdefgh", ...withdrawnProfile(shop(), input, STAFF) }) as ProProfileRecord;
  const submitted: ProProfileDoc = {
    ...withdrawnProfile(shop(), input, STAFF),
    name: "Atlas Auto SARL",
    slug: "atlas-auto-sarl-casablanca",
    description: "Concession, nouvelle société.",
    legal: { form: "societe", ice: "009876543000021", rc: "54321", if: "7654321" },
    kybc: { status: "submitted", iceFormatOk: true, uploadIds: ["up2"], submittedAt: RESENT },
    lifecycle: "pending_verification",
    plan: "none",
    planSource: "none",
    quotas: DEFAULT_PRICING.pro.none,
    staffNotes: undefined,
    sections: undefined,
  };

  it("may be sent while none is under review", () => {
    expect(awaitsRevalidation(withdrawn())).toBe(true);
    expect(canResubmit(withdrawn())).toBe(true);
    const resent = { ...withdrawn(), kybc: { ...withdrawn().kybc, status: "submitted" as const } };
    expect(canResubmit(resent)).toBe(false);
    expect(canResubmit(shop())).toBe(false);
    expect(canResubmit(shop({ lifecycle: "rejected", kybc: { ...shop().kybc, status: "rejected" } }))).toBe(true);
  });

  it("replaces the application's fields and keeps the rest (plan, sections, notes, state to restore)", () => {
    const next = revalidationSubmission(withdrawn(), submitted, RESENT);
    expect(next).toMatchObject({ name: "Atlas Auto SARL", legal: { ice: "009876543000021" }, lifecycle: "revalidation_required", revalidationFrom: "verified", plan: "essentiel", planSource: "launch_offer", updatedAt: RESENT });
    expect(next.kybc).toMatchObject({ status: "submitted", uploadIds: ["up2"], submittedAt: RESENT, withdrawReason: input.statement });
    expect(next.sections).toEqual([{ id: "neuf01", name: "Neuf" }]);
    expect(next.staffNotes).toHaveLength(1);
    expect(proProfileSchema.safeParse(next).success).toBe(true);
  });

  it("is validated back to the state held before, with its plan; a refusal keeps it under revalidation", () => {
    const review = { proId: "abcdefgh", ...revalidationSubmission(withdrawn(), submitted, RESENT) } as ProProfileRecord;
    const ctx = { staffUid: "uid-moderator", now: RESENT, launchOfferActive: false, pricing: DEFAULT_PRICING };
    const verified = decidedProfile(review, { action: "verify", registrySource: "ompic", submittedAt: RESENT.toISOString() }, ctx);
    expect(verified).toMatchObject({ lifecycle: "verified", plan: "essentiel", planSource: "launch_offer", quotas: DEFAULT_PRICING.pro.essentiel });
    expect(verified.revalidationFrom).toBeUndefined();
    expect(verified.kybc.withdrawReason).toBeUndefined();
    expect(verified.kybc.status).toBe("verified");
    expect(proProfileSchema.safeParse(verified).success).toBe(true);

    const refused = decidedProfile(review, { action: "reject", reason: "L'ICE ne correspond pas au registre.", submittedAt: RESENT.toISOString() }, ctx);
    expect(refused).toMatchObject({ lifecycle: "revalidation_required", revalidationFrom: "verified", plan: "essentiel" });
    expect(refused.kybc).toMatchObject({ status: "rejected", rejectReason: "L'ICE ne correspond pas au registre." });
    // The shop keeps its data: no retention purge as for a refused first application.
    expect(refused.purgeAt).toBeUndefined();
    expect(awaitsRevalidation(refused)).toBe(true);
  });
});
