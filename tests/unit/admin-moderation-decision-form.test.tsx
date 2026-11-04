import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as NextNavigation from "next/navigation";
import { CONFIRM_APPROVAL_SCORE, ModerationDecisionForm, rejectRecap } from "@/app/admin/_components/moderation-decision-form";
import { FlagBadges } from "@/app/admin/_components/moderation-queue";
import { DECLARATION_SIGNAL, SensitiveDeclarationNotice, declarationReminder } from "@/app/admin/_components/sensitive-declaration";
import { REJECT_REASONS } from "@/lib/moderation/decisions";

// Held-listing decision (audit zone 7 P2-2, synthesis B5): nothing chosen beforehand, the submit
// waits for a choice, and the threshold of the high-risk confirmation. A rejection is read back
// before it is sent (P3-11); a declared sensitive listing carries its signal and reminder (P3-2).

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

const render = (riskScore: number) =>
  renderToStaticMarkup(<ModerationDecisionForm listingId="abcd2345ef" version={3} approval={{ kind: "publication", status: "published" }} expiresAt={null} riskScore={riskScore} />);

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("ModerationDecisionForm", () => {
  it("preselects neither decision and keeps the submit disabled until one is chosen", () => {
    const html = render(95);
    expect(html).not.toMatch(/checked=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Choisissez une décision/);
    expect(html).not.toContain("Publier l&#x27;annonce");
    expect(html).not.toContain("Avant d&#x27;envoyer le refus");
  });

  it("asks for a confirmation from a score of 80", () => {
    expect(CONFIRM_APPROVAL_SCORE).toBe(80);
  });
});

describe("rejection recap (zone 7 P3-11)", () => {
  it("reads back the reason, the statement the seller gets and the moderator's words as written", () => {
    const recap = rejectRecap("counterfeit", "  Logo de la marque visible sur la photo 2.  ");
    expect(recap.label).toBe(REJECT_REASONS.counterfeit.label);
    expect(recap.statement).toBe("L'annonce semble proposer une contrefaçon ou une copie d'une marque.");
    expect(recap.details).toBe("Logo de la marque visible sur la photo 2.");
    expect(recap.ground).toBe(REJECT_REASONS.counterfeit.ground.ref);
    expect(recap.after).toContain("lien de recours");
  });

  it("says when the moderator added nothing", () => {
    expect(rejectRecap("spam", "   ").details).toBeNull();
  });
});

describe("sensitive declaration (zone 7 P3-2)", () => {
  it("names who the data concern on the flag list, first, without a second generic badge", () => {
    const html = text(renderToStaticMarkup(<FlagBadges flags={["dup_photo", "sensitive_declared", "new_account"]} declaration="explicit_consent" />));
    expect(html).toContain("Données sensibles déclarées (tiers avec accord)");
    expect(html.indexOf("tiers avec accord")).toBeLessThan(html.indexOf("Photo en double"));
    expect(html.match(/Données sensibles déclarées/g)).toHaveLength(1);
  });

  it("shows the declaration even when the hold predates its flag, and the generic label without one", () => {
    expect(text(renderToStaticMarkup(<FlagBadges flags={[]} declaration="self" />))).toContain(DECLARATION_SIGNAL.self);
    expect(text(renderToStaticMarkup(<FlagBadges flags={["sensitive_declared"]} />))).toContain("Données sensibles déclarées");
    expect(text(renderToStaticMarkup(<FlagBadges flags={[]} />))).toContain("Aucun signal");
  });

  it("reminds the moderator of the platform's responsibility and of the refusal reason", () => {
    for (const kind of ["self", "explicit_consent"] as const) {
      const reminder = declarationReminder(kind);
      expect(reminder).toContain("Russmedia");
      expect(reminder).toContain(`« ${REJECT_REASONS.sensitive_data.label} »`);
    }
    const html = text(renderToStaticMarkup(<SensitiveDeclarationNotice kind="explicit_consent" />));
    expect(html).toContain(DECLARATION_SIGNAL.explicit_consent);
    expect(html).toContain("une autre personne");
  });
});
