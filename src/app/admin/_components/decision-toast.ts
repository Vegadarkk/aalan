import { toast } from "sonner";

// Confirmation of a moderation decision (audit zone 7 P2-3): what was done, the decision number,
// and a link to the decision page, shown on the list the moderator goes back to. Client-only.

export interface DecisionToastInput {
  title: string;
  /** What follows from it ("vendeur prévenu par e-mail"); the decision number is appended. */
  description?: string;
  decisionId?: string | null;
  /** Client navigation (router.push) for the "Voir la décision" action. */
  navigate: (href: string) => void;
}

export function decisionToast({ title, description, decisionId, navigate }: DecisionToastInput): void {
  const parts = [description?.replace(/[.\s]+$/, ""), decisionId ? `décision n° ${decisionId}` : null].filter(Boolean);
  toast.success(title, {
    ...(parts.length > 0 ? { description: `${parts.join(" · ")}.` } : {}),
    ...(decisionId ? { action: { label: "Voir la décision", onClick: () => navigate(`/decisions/${encodeURIComponent(decisionId)}`) } } : {}),
  });
}
