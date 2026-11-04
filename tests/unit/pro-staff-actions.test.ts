import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "@/config/pricing";
import { proLifecycleActionSchema } from "@/lib/contracts/pro";
import type { ProProfileRecord } from "@/lib/db/repositories/pro-profiles";
import { HttpError } from "@/lib/http/errors";
import { proProfileSchema } from "@/lib/pro/profile-schema";
import { notesView, profileAfter } from "@/lib/pro/staff-actions";

// Staff actions on a validated shop (zone 7 audit P2-10): a team note and the activity
// correction, as the profile reads after them.

const AT = new Date("2026-11-04T10:00:00.000Z");
const BY = { at: AT, by: "uid-moderator", byName: "Karim" };

function record(extra: Partial<ProProfileRecord> = {}): ProProfileRecord {
  return {
    proId: "abcdefgh",
    ownerUid: "uid-owner",
    members: { "uid-owner": "owner" },
    name: "Atlas Garage",
    slug: "atlas-garage-casablanca",
    description: "",
    whatsapp: false,
    regionCode: "06",
    citySlug: "casablanca",
    legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" },
    kybc: { status: "verified", iceFormatOk: true, uploadIds: ["up1"], submittedAt: AT, complianceCommitmentAt: AT },
    lifecycle: "verified",
    plan: "essentiel",
    planSource: "launch_offer",
    quotas: DEFAULT_PRICING.pro.essentiel,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

function status(run: () => unknown): number {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return (error as HttpError).status;
  }
  throw new Error("expected an HttpError");
}

describe("profileAfter", () => {
  it("adds a note on top, keeps the last 20, and the profile stays valid", () => {
    const old = Array.from({ length: 20 }, (_, index) => ({ at: new Date(AT.getTime() - (index + 1) * 60_000), by: "uid-admin", byName: "Nadia", text: `Note ${index + 1}` }));
    const { doc, sectorChange } = profileAfter(record({ staffNotes: old }), { action: "note", text: "Appelé le gérant : stock confirmé." }, BY);
    expect(sectorChange).toBeNull();
    expect(doc.staffNotes).toHaveLength(20);
    expect(doc.staffNotes?.[0]).toEqual({ ...BY, text: "Appelé le gérant : stock confirmé." });
    expect(doc.staffNotes?.at(-1)?.text).toBe("Note 19");
    expect(proProfileSchema.safeParse(doc).success).toBe(true);
    expect(notesView(doc.staffNotes)[0]).toEqual({ at: AT.toISOString(), by: "Karim", text: "Appelé le gérant : stock confirmé." });
  });

  it("corrects a validated shop's activity and leaves the reason in the notes (Concession automobile, P1-2)", () => {
    const { doc, sectorChange } = profileAfter(record(), { action: "sector", sector: "dealer", reason: "Justificatifs d'une concession Renault." }, BY);
    expect(sectorChange).toEqual({ from: "general", to: "dealer" });
    expect(doc.sector).toBe("dealer");
    expect(doc.staffNotes?.[0]?.text).toBe("Activité corrigée : Commerce et services → Concession automobile. Justificatifs d'une concession Renault.");
    expect(proProfileSchema.safeParse(doc).success).toBe(true);
  });

  it("stores a general shop as no sector and drops a real-estate fee schedule", () => {
    const { doc } = profileAfter(record({ sector: "real_estate", agency: { feeSchedule: "3 % du prix" }, sectorCommitment: { sector: "real_estate", version: "1", at: AT } }), { action: "sector", sector: "general", reason: "Pas d'activité d'agence." }, BY);
    expect(doc.sector).toBeUndefined();
    expect(doc.agency).toBeUndefined();
  });

  it("refuses an agency sector the owner never accepted, the same activity, or a shop not validated", () => {
    expect(status(() => profileAfter(record(), { action: "sector", sector: "car_rental", reason: "Location de voitures en réalité." }, BY))).toBe(409);
    expect(status(() => profileAfter(record({ sector: "dealer" }), { action: "sector", sector: "dealer", reason: "Rien ne change ici." }, BY))).toBe(409);
    expect(status(() => profileAfter(record({ lifecycle: "pending_verification", kybc: { status: "submitted", iceFormatOk: true, uploadIds: ["up1"], submittedAt: AT, complianceCommitmentAt: AT } }), { action: "sector", sector: "dealer", reason: "Avant la décision." }, BY))).toBe(409);
    // A suspended shop keeps its record: its activity can still be corrected.
    expect(profileAfter(record({ lifecycle: "suspended", suspendedFrom: "verified" }), { action: "sector", sector: "dealer", reason: "Concession, vérifié au registre." }, BY).doc.sector).toBe("dealer");
  });
});

describe("proLifecycleActionSchema", () => {
  it("needs a real reason for a correction and a note within 500 characters", () => {
    expect(proLifecycleActionSchema.safeParse({ action: "sector", sector: "dealer", reason: "court" }).success).toBe(false);
    expect(proLifecycleActionSchema.safeParse({ action: "note", text: "x".repeat(501) }).success).toBe(false);
    expect(proLifecycleActionSchema.safeParse({ action: "note", text: "Boutique rappelée." }).success).toBe(true);
    expect(proLifecycleActionSchema.safeParse({ action: "suspend" }).success).toBe(false);
  });
});
