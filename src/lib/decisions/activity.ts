// Audit actions the back-office home lists as the team's recent work (zone 7 audit P2-6), in
// French. Client-safe. Only the moderation work is listed: reads of KYBC pieces or conversations,
// exports and configuration changes stay in the audit log. `adminOnly`: an action on a section a
// moderator cannot open (authority requests), left out of a moderator's feed.

interface ActivityKind {
  label: string;
  adminOnly?: boolean;
}

const EXACT: Record<string, ActivityKind> = {
  "listing.approve": { label: "Annonce retenue publiée" },
  "listing.reject": { label: "Annonce retenue refusée" },
  "listing.hide": { label: "Annonce masquée" },
  "listing.unhide": { label: "Annonce rétablie" },
  "pro.verify": { label: "Compte Pro validé" },
  "pro.reject": { label: "Demande Pro refusée" },
  "pro.phone.check": { label: "Appel de vérification Pro" },
  "pro.note": { label: "Note sur une boutique Pro" },
  "pro.sector.correct": { label: "Activité d'une boutique corrigée" },
  "pro.validation.withdraw": { label: "Validation d'une boutique Pro retirée" },
  "pro.rental_check.verify": { label: "Agrément de location validé" },
  "pro.rental_check.reject": { label: "Agrément de location refusé" },
  "pro.payment.suspended": { label: "Paiement chez le vendeur suspendu" },
  "pro.payment.restored": { label: "Paiement chez le vendeur rétabli" },
  "pro.social.hidden": { label: "Réseaux sociaux d'une boutique masqués" },
  "pro.social.restored": { label: "Réseaux sociaux d'une boutique rétablis" },
  "phone.revoked": { label: "Badge téléphone retiré" },
  "user.avatar_removed": { label: "Photo de profil retirée" },
  "reporter.warn": { label: "Signalant averti pour abus" },
  "reporter.suspend": { label: "Signalements d'un membre suspendus" },
  "appeal.upheld": { label: "Recours rejeté, décision maintenue" },
  "appeal.reversed": { label: "Décision annulée sur recours" },
  "authority.create": { label: "Demande d'autorité enregistrée", adminOnly: true },
  "authority.answer": { label: "Demande d'autorité répondue", adminOnly: true },
  "authority.close": { label: "Demande d'autorité close", adminOnly: true },
};

const DECISION: Record<string, string> = {
  remove: "Retrait",
  restrict_visibility: "Visibilité restreinte",
  restore: "Rétablissement",
  no_action: "Signalement sans suite",
  warn: "Avertissement",
  suspend_account: "Suspension de compte",
  ban: "Fermeture de compte",
  demote: "Rétrogradation",
};

/** The feed's wording of an audit action, or null when the home does not list it. */
export function activityKind(action: string): ActivityKind | null {
  const exact = EXACT[action];
  if (exact) return exact;
  if (action.startsWith("decision.")) {
    const label = DECISION[action.slice("decision.".length)];
    return label ? { label } : null;
  }
  return null;
}

/** Whether a viewer of this role sees the action in the feed. */
export function activityShown(action: string, admin: boolean): boolean {
  const kind = activityKind(action);
  return kind !== null && (admin || !kind.adminOnly);
}
