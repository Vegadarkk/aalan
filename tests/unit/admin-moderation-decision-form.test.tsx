import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as NextNavigation from "next/navigation";
import { CONFIRM_APPROVAL_SCORE, ModerationDecisionForm } from "@/app/admin/_components/moderation-decision-form";

// Held-listing decision (audit zone 7 P2-2, synthesis B5): nothing chosen beforehand, the submit
// waits for a choice, and the threshold of the high-risk confirmation.

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

const render = (riskScore: number) =>
  renderToStaticMarkup(<ModerationDecisionForm listingId="abcd2345ef" version={3} approval={{ kind: "publication", status: "published" }} expiresAt={null} riskScore={riskScore} />);

describe("ModerationDecisionForm", () => {
  it("preselects neither decision and keeps the submit disabled until one is chosen", () => {
    const html = render(95);
    expect(html).not.toMatch(/checked=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Choisissez une décision/);
    expect(html).not.toContain("Publier l&#x27;annonce");
  });

  it("asks for a confirmation from a score of 80", () => {
    expect(CONFIRM_APPROVAL_SCORE).toBe(80);
  });
});
