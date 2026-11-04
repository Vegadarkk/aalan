import { describe, expect, it } from "vitest";
import { DEFAULT_AI } from "@/config/ai";
import { ALWAYS_REVIEW_FLAGS, HUMAN_REVIEW_FLAGS } from "@/lib/moderation/risk";
import { findOffsitePayment, spellsPhoneNumber } from "@/lib/moderation/scam";
import { screenListing } from "@/lib/moderation/screen";
import type { ScreenInput } from "@/lib/moderation/types";

// Scam signals (audit zone 7 P2-1, synthesis B5): the "iPhone 15 Pro Max, Western Union avant
// envoi, numéro en lettres" listing of a day-old account scored 15 and went public.

const ctx = { ai: DEFAULT_AI };

function phoneListing(overrides: Partial<ScreenInput> = {}): ScreenInput {
  return {
    title: "iPhone 15 Pro Max 256 Go",
    description: "iPhone 15 Pro Max 256 Go, très bon état, boîte et facture. Remise en main propre à Casablanca.",
    // Criteria are not this test's concern: only the text blockers are checked.
    attributes: {},
    categoryId: "electronique",
    subcategoryId: "telephones-objets-connectes",
    price: 9_000,
    isDonation: false,
    contact: { showPhone: false, whatsapp: false },
    sensitiveDeclaration: null,
    photos: [{ checks: { nsfw: 0.01, faces: 0 } }],
    seller: { accountAgeDays: 0, listingsLast24h: 1, phoneVerified: false, previousRejections: 0 },
    duplicates: { sameText: 0, samePhoto: 0 },
    ...overrides,
  };
}

describe("findOffsitePayment", () => {
  it("finds cash-transfer networks and payment before shipping, in French, Arabic and darija", () => {
    expect(findOffsitePayment("Paiement par Western Union avant envoi, urgent")).toEqual(["western union", "avant envoi"]);
    expect(findOffsitePayment("Envoyez par MoneyGram ou mandat cash")).toEqual(["moneygram", "mandat cash"]);
    expect(findOffsitePayment("Payer avant l'expédition svp")).toEqual(["payer avant", "avant l'expedition"]);
    expect(findOffsitePayment("الدفع عبر ويسترن يونيون قبل الإرسال")).toEqual(["ويسترن يونيون", "قبل الارسال"]);
    expect(findOffsitePayment("dir wafacash")).toEqual(["wafacash"]);
  });

  it("leaves ordinary listings alone", () => {
    for (const text of ["Appartement à louer, caution et avance de deux mois", "Paiement à la livraison possible", "Virement accepté pour les professionnels", "Bottes style western, pointure 42", "Acompte à la signature du compromis"]) {
      expect(findOffsitePayment(text), text).toEqual([]);
    }
  });
});

describe("spellsPhoneNumber", () => {
  it("finds a number spelled out, alone or mixed with digit groups", () => {
    expect(spellsPhoneNumber("Appelez le zéro six soixante et un vingt-trois quarante-cinq soixante-sept")).toBe(true);
    expect(spellsPhoneNumber("contact zero six 61 23 quarante cinq 67")).toBe(true);
    expect(spellsPhoneNumber("صفر ستة واحد اثنين ثلاثة اربعة خمسة")).toBe(true);
    expect(spellsPhoneNumber("zero stta wahed jouj tlata rb3a khamsa")).toBe(true);
  });

  it("leaves sizes, prices and specs alone", () => {
    for (const text of ["Tailles 36 38 40 42 44 46 disponibles", "Lot de deux chaises et une table", "Clio 4 2019 diesel 90 000 km", "Vendu cent cinquante mille dirhams", "Pour enfants de six, sept ou huit ans", "iPhone 15 Pro Max 256 Go"]) {
      expect(spellsPhoneNumber(text), text).toBe(false);
    }
  });
});

describe("screenListing: scam signals", () => {
  it("holds the audit's scam for a moderator, whatever the score", () => {
    const scam = phoneListing({
      description: "iPhone 15 Pro Max neuf sous blister, prix cassé car départ urgent. Paiement par Western Union avant envoi. Contact zéro six soixante et un vingt-trois quarante-cinq soixante-sept.",
    });
    const result = screenListing(scam, ctx);
    expect(result.state).toBe("needs_review");
    expect(result.flags).toEqual(expect.arrayContaining(["offsite_payment", "phone_in_words", "new_account"]));
    // Spelled out, the number slips past the phone blocker: the flag is what holds it.
    expect(result.blockers.filter((blocker) => blocker.code.endsWith("_in_text"))).toEqual([]);
    expect(result.evidence).toContain('offsite payment "western union" in description');
    expect(result.evidence).toContain("phone number spelled out in description");
  });

  it("keeps a clean listing of a new account automatic", () => {
    const result = screenListing(phoneListing(), ctx);
    expect(result.state).toBe("auto_ok");
    expect(result.flags).not.toContain("offsite_payment");
    expect(result.flags).not.toContain("phone_in_words");
  });

  it("always holds the scam flags, which weigh in the score shown to the moderator", () => {
    for (const flag of ["offsite_payment", "phone_in_words"] as const) {
      expect(ALWAYS_REVIEW_FLAGS.has(flag)).toBe(true);
      expect(HUMAN_REVIEW_FLAGS.has(flag)).toBe(false);
    }
  });
});
