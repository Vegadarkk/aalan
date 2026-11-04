import { randomInt } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/admin/pros/{proId}/lifecycle against the emulators (zone 7 audit P2-10): a moderator
// leaves a note on a validated shop and corrects its activity with a reason; both are journaled,
// the review shows the notes, members cannot call it, and an unaccepted agency sector is refused.

vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));

import { POST as postLifecycle } from "@/app/api/admin/pros/[proId]/lifecycle/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { ProLifecycleResponse } from "@/lib/contracts/pro";
import { getProProfile, proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { proReview } from "@/lib/pro/review";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { api, member, type ErrorBody } from "../listings/helpers";
import { admin, code, staffAccount } from "./helpers";

const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");

beforeEach(() => resetRateLimiters());

async function shop(extra: Partial<ProProfileDoc> = {}): Promise<string> {
  const owner = await member();
  const proId = newProId();
  const now = new Date();
  await proProfileRef(proId).set(
    proProfileToFirestore({
      ownerUid: owner.uid,
      members: { [owner.uid]: "owner" },
      name: "Atlas Garage",
      slug: `atlas-garage-${proId}`,
      description: "",
      whatsapp: false,
      regionCode: "06",
      citySlug: "casablanca",
      legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" },
      kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
      lifecycle: "verified",
      plan: "essentiel",
      planSource: "launch_offer",
      quotas: DEFAULT_PRICING.pro.essentiel,
      createdAt: now,
      updatedAt: now,
      ...extra,
    }),
  );
  await db().collection(COLLECTIONS.users).doc(owner.uid).update({ proId });
  return proId;
}

async function audits(proId: string): Promise<{ action: string; reason?: string }[]> {
  const snapshot = await db().collection(COLLECTIONS.auditLogs).where("target.id", "==", proId).get();
  return snapshot.docs.map((doc) => ({ action: doc.get("action") as string, reason: doc.get("reason") as string | undefined }));
}

describe("POST /api/admin/pros/{proId}/lifecycle", () => {
  it("adds a note and corrects the activity of a validated shop, both journaled and shown on the record", async () => {
    const moderator = await staffAccount("moderator");
    const proId = await shop();
    const path = `/api/admin/pros/${proId}/lifecycle`;

    const noted = await admin<ProLifecycleResponse>(postLifecycle, "POST", path, moderator, { action: "note", text: "Gérant rappelé : concession Renault confirmée." });
    expect(noted.status).toBe(200);
    expect(noted.body.notes[0]).toMatchObject({ by: moderator.email, text: "Gérant rappelé : concession Renault confirmée." });

    const corrected = await admin<ProLifecycleResponse>(postLifecycle, "POST", path, moderator, { action: "sector", sector: "dealer", reason: "Demande « Concession automobile » perdue à la validation." });
    expect(corrected.status).toBe(200);
    expect(corrected.body.sector).toBe("dealer");
    expect((await getProProfile(proId))?.sector).toBe("dealer");
    const review = await proReview(proId);
    expect(review?.sector).toBe("dealer");
    expect(review?.notes.map((note) => note.text)).toEqual([
      "Activité corrigée : Commerce et services → Concession automobile. Demande « Concession automobile » perdue à la validation.",
      "Gérant rappelé : concession Renault confirmée.",
    ]);
    const entries = await audits(proId);
    expect(entries).toEqual(
      expect.arrayContaining([
        { action: "pro.note", reason: "Gérant rappelé : concession Renault confirmée." },
        { action: "pro.sector.correct", reason: "sector general -> dealer: Demande « Concession automobile » perdue à la validation." },
      ]),
    );
  });

  it("refuses an agency sector the owner never accepted, a short reason, a shop under review, and members", async () => {
    const moderator = await staffAccount("moderator");
    const proId = await shop();
    const path = `/api/admin/pros/${proId}/lifecycle`;
    const agency = await admin<ErrorBody>(postLifecycle, "POST", path, moderator, { action: "sector", sector: "car_rental", reason: "Loue des voitures en réalité." });
    expect(agency.status).toBe(409);
    expect(code(agency.body)).toBe("commitments_required");
    expect((await admin(postLifecycle, "POST", path, moderator, { action: "sector", sector: "dealer", reason: "court" })).status).toBe(400);

    const pending = await shop({ lifecycle: "pending_verification", kybc: { status: "submitted", iceFormatOk: true, uploadIds: [] } });
    expect((await admin(postLifecycle, "POST", `/api/admin/pros/${pending}/lifecycle`, moderator, { action: "sector", sector: "dealer", reason: "Avant la décision KYBC." })).status).toBe(409);

    const someone = await member();
    const denied = await api<ErrorBody>(postLifecycle, "POST", path, { member: someone, body: { action: "note", text: "Je ne suis pas staff." }, params: { proId } });
    expect([401, 403, 404]).toContain(denied.status);
  });
});
