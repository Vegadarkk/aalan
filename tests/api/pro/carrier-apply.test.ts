import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as RuntimeModule from "@/lib/config/runtime";

// Carriers space, lot 1a (transporteurs/spec.md, owner 2026-11-10) against the Firebase emulators:
// the carrier activity behind `carriersEnabled`, an EU company applying as a carrier only with an
// EU mobile for the moderator's call, its review and verification, and a carrier that stays one.

const flags = vi.hoisted(() => ({ carriersEnabled: true }));
vi.mock("@/lib/config/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeModule>();
  return {
    ...actual,
    getFlags: vi.fn(async () => ({
      ...(await actual.getFlags()),
      carriersEnabled: flags.carriersEnabled,
    })),
  };
});
vi.mock("@/lib/search/queue", () => ({
  notifySearchIndex: vi.fn(async () => undefined),
}));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/turnstile", () => ({
  verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })),
}));

import { GET as getQueue } from "@/app/api/admin/pros/route";
import {
  GET as getReview,
  POST as postDecision,
} from "@/app/api/admin/pros/[proId]/route";
import { POST as postPhoneCheck } from "@/app/api/admin/pros/[proId]/phone/route";
import { PUT as putAgency } from "@/app/api/pro/me/agency/route";
import { GET as getMe } from "@/app/api/pro/me/route";
import type {
  ProDecisionResponse,
  ProMeResponse,
  ProPhoneCheckResponse,
  ProQueueResponse,
  ProReview,
} from "@/lib/contracts/pro";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { getUserPrivate } from "@/lib/db/repositories/users";
import { resetServerEnv } from "@/lib/env";
import { createSessionForUid } from "@/lib/firebase/session";
import { csrfToken } from "@/lib/security/csrf";
import { api, member, type ErrorBody, type Member } from "../listings/helpers";
import {
  admin,
  application,
  applyAs,
  code,
  kybPiece,
  staffAccount,
  type Staff,
} from "./helpers";

const EU_LEGAL = {
  form: "entreprise_ue",
  country: "FR",
  registry: "732 829 320 00074",
  vat: "FR 44 732829320",
};
let counter = 0;
/** A French mobile no other test account holds (+33 6 1x xx xx xx). */
const euMobile = () =>
  `+3361${String((Date.now() + counter++) % 10_000_000).padStart(7, "0")}`;

let moderator: Staff;

beforeAll(async () => {
  resetServerEnv();
  moderator = await staffAccount("moderator");
});

beforeEach(() => {
  flags.carriersEnabled = true;
});

describe("carrier application", () => {
  it("is offered only while the carriers space is open", async () => {
    const owner = await member();
    flags.carriersEnabled = false;
    expect(
      (await api<ProMeResponse>(getMe, "GET", "/api/pro/me", { member: owner }))
        .body.carriersOpen,
    ).toBe(false);
    const closed = await applyAs(
      owner,
      application([await kybPiece(owner)], {
        sector: "carrier",
        sectorCommitment: true,
        phone: "06 11 22 33 44",
      }),
    );
    expect(closed.status).toBe(403);
    expect(code(closed.body)).toBe("carriers_closed");
    flags.carriersEnabled = true;
    expect(
      (await api<ProMeResponse>(getMe, "GET", "/api/pro/me", { member: owner }))
        .body.carriersOpen,
    ).toBe(true);
  });

  it("refuses an EU company for another activity, and a carrier without its commitments", async () => {
    const owner = await member();
    const shop = await applyAs(
      owner,
      application([await kybPiece(owner)], {
        legal: EU_LEGAL,
        phone: euMobile(),
      }),
    );
    expect(shop.status).toBe(400);
    expect(code(shop.body)).toBe("legal_form_sector");
    const bare = await applyAs(
      owner,
      application([await kybPiece(owner)], {
        legal: EU_LEGAL,
        sector: "carrier",
        phone: euMobile(),
      }),
    );
    expect(code(bare.body)).toBe("commitments_required");
    const badRegistry = await applyAs(
      owner,
      application([await kybPiece(owner)], {
        legal: { ...EU_LEGAL, registry: "732829321" },
        sector: "carrier",
        sectorCommitment: true,
        phone: euMobile(),
      }),
    );
    expect(badRegistry.status).toBe(400);
  });

  it("takes an EU carrier with its EU mobile, reviewed, called and verified on its country's register", async () => {
    const owner = await member();
    const phone = euMobile();
    const landline = await applyAs(
      owner,
      application([await kybPiece(owner)], {
        legal: EU_LEGAL,
        sector: "carrier",
        sectorCommitment: true,
        phone: "+33 1 23 45 67 89",
      }),
    );
    expect(code(landline.body)).toBe("phone_not_mobile");
    const applied = await applyAs(
      owner,
      application([await kybPiece(owner)], {
        legal: EU_LEGAL,
        sector: "carrier",
        sectorCommitment: true,
        phone: phone.replace(/^\+33(\d)/, "+33 $1 "),
      }),
    );
    expect(applied.body).toMatchObject({ status: "pending_verification" });
    const proId = applied.body.proId;
    const profile = await getProProfile(proId);
    expect(profile).toMatchObject({
      sector: "carrier",
      legal: {
        form: "entreprise_ue",
        country: "FR",
        registry: "73282932000074",
        vat: "FR44732829320",
      },
      sectorCommitment: { sector: "carrier" },
    });
    expect(profile?.kybc).toMatchObject({
      iceFormatOk: true,
      phoneToCheck: phone,
    });

    const self = await api<ProMeResponse>(getMe, "GET", "/api/pro/me", {
      member: owner,
    });
    expect(self.body.shop).toMatchObject({
      sector: "carrier",
      legalForm: "entreprise_ue",
      ice: "",
      legalCountry: "FR",
    });

    const queue = await admin<ProQueueResponse>(
      getQueue,
      "GET",
      "/api/admin/pros",
      moderator,
    );
    expect(queue.body.items.find((item) => item.proId === proId)).toMatchObject(
      { legalForm: "entreprise_ue", ice: "73282932000074", iceFormatOk: true },
    );
    const review = await admin<{ review: ProReview }>(
      getReview,
      "GET",
      `/api/admin/pros/${proId}`,
      moderator,
    );
    expect(review.body.review.legal).toEqual({
      form: "entreprise_ue",
      country: "FR",
      registry: "73282932000074",
      vat: "FR44732829320",
    });
    expect(review.body.review.correctableSectors).toEqual(["carrier"]);

    const called = await admin<ProPhoneCheckResponse>(
      postPhoneCheck,
      "POST",
      `/api/admin/pros/${proId}/phone`,
      moderator,
      { outcome: "verified" },
    );
    expect(called.body).toMatchObject({
      outcome: "verified",
      phoneVerified: true,
    });
    expect((await getUserPrivate(owner.uid))?.phoneE164).toBe(phone);

    const wrongSector = await admin<ErrorBody>(
      postDecision,
      "POST",
      `/api/admin/pros/${proId}`,
      moderator,
      {
        action: "verify",
        registrySource: "eu_register",
        sector: "general",
        submittedAt: review.body.review.kybc.submittedAt!,
      },
    );
    expect(wrongSector.status).toBe(409);
    const decided = await admin<ProDecisionResponse>(
      postDecision,
      "POST",
      `/api/admin/pros/${proId}`,
      moderator,
      {
        action: "verify",
        registrySource: "eu_register",
        submittedAt: review.body.review.kybc.submittedAt!,
      },
    );
    expect(decided.status).toBe(200);
    expect((await getProProfile(proId))?.kybc.registryCheck?.source).toBe(
      "eu_register",
    );

    // Signed in again (the decision revoked the session): the EU carrier stays a carrier.
    await signInAgain(owner);
    const general = await api<ErrorBody>(
      putAgency,
      "PUT",
      "/api/pro/me/agency",
      { member: owner, body: { sector: "general", feeSchedule: "" } },
    );
    expect(general.status).toBe(409);
    expect(code(general.body)).toBe("legal_form_sector");
  });
});

async function signInAgain(owner: Member): Promise<void> {
  const minted = await createSessionForUid(owner.uid);
  owner.jar.cookies.set("__Host-session", minted.cookie);
  owner.jar.cookies.set("__Host-csrf", csrfToken(minted.cookie));
}
