import { ErrorBanner } from "@/components/feedback/error-banner";
import type { SensitiveDeclarationKind } from "@/lib/contracts/listings";

// The seller's sensitive-data declaration (architecture §7 step 3, Russmedia; audit zone 7 P3-2):
// a named signal on the queue card and the review, and the legal reminder at the top of the review.

/** Signal label, with who the data concern. */
export const DECLARATION_SIGNAL: Record<SensitiveDeclarationKind, string> = {
  self: "Données sensibles déclarées (le vendeur lui-même)",
  explicit_consent: "Données sensibles déclarées (tiers avec accord)",
};

const DECLARATION_TEXT: Record<SensitiveDeclarationKind, { declared: string; check: string }> = {
  self: {
    declared: "Le vendeur déclare être la personne concernée par les données sensibles de l'annonce (santé, religion, origine, opinions, vie privée).",
    check: "vérifiez que l'annonce ne vise bien que lui et n'en dit pas plus que nécessaire",
  },
  explicit_consent: {
    declared: "Le vendeur déclare publier les données sensibles d'une autre personne (santé, religion, origine, opinions, vie privée), avec son accord explicite.",
    check: "vérifiez que cet accord est plausible et que l'annonce n'en dit pas plus que nécessaire",
  },
};

/** The reminder of what the moderator answers for before publishing a declared listing. */
export function declarationReminder(kind: SensitiveDeclarationKind): string {
  return `${DECLARATION_TEXT[kind].declared} Aalan répond du traitement de ces données, même en tant qu'hébergeur (CJUE, arrêt Russmedia, C-492/23) : ${DECLARATION_TEXT[kind].check}. Au moindre doute, refusez avec le motif « Données sensibles ».`;
}

export function SensitiveDeclarationNotice({ kind }: { kind: SensitiveDeclarationKind }) {
  return (
    <ErrorBanner tone="warning" title={DECLARATION_SIGNAL[kind]} className="max-w-3xl">
      <p className="text-pretty" data-testid="sensitive-declaration">
        {declarationReminder(kind)}
      </p>
    </ErrorBanner>
  );
}
