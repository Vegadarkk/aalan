"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { InlineError } from "@/components/feedback/inline-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { inputClassName } from "@/components/ui/input";
import {
  DECISION_DETAILS_MIN,
  DECISION_TEXT_MAX,
  REJECT_REASON_CODES,
  REJECT_REASONS,
  type ModerationDecisionRequest,
  type ModerationDecisionResponse,
  type RejectReasonCode,
} from "@/lib/moderation/decisions";
import type { ApprovalOutcome } from "@/lib/listings/lifecycle";
import { cn } from "@/lib/utils";
import { adminFetch, errorMessage } from "./api-client";
import { decisionToast } from "./decision-toast";
import { formatMorocco } from "../_lib/moderation-format";

export const MODERATION_API = "/api/admin/moderation";

const MESSAGES: Record<string, string> = {
  conflict: "Cette annonce a changé depuis l'ouverture de la page (modification du vendeur ou décision d'un autre modérateur). Rechargez la page avant de décider.",
  not_found: "Cette annonce n'existe plus.",
  invalid_body: "Choisissez un motif. « Autre motif » demande une précision d'au moins 10 caractères.",
  forbidden: "Réservé aux modérateurs et aux admins.",
  rate_limited: "Trop de décisions en peu de temps. Réessayez dans quelques minutes.",
  account_suspended: "Le compte du vendeur n'est pas actif (suspendu ou fermé) : l'annonce ne peut pas être publiée. Refusez-la ou laissez-la en attente.",
};

type Choice = "approve" | "reject";

/** From this risk score an approval asks the moderator to confirm the signals were checked (audit zone 7 P2-2, B5). */
export const CONFIRM_APPROVAL_SCORE = 80;

/**
 * What approving does, in the moderator's words (lifecycle `approvalOutcome`): a publication or a
 * renewal goes online for the normal lifetime; an edit gives back the status the seller had.
 */
function approveCopy(approval: ApprovalOutcome, expiresAt: string | null): { label: string; description: string; submit: string } {
  if (approval.kind === "publication") return { label: "Publier", description: "L'annonce est mise en ligne pour la durée normale ; le vendeur est prévenu.", submit: "Publier l'annonce" };
  if (approval.kind === "renewal") {
    return { label: "Publier", description: "Renouvellement d'une annonce expirée : elle est remise en ligne pour la durée normale ; le vendeur est prévenu.", submit: "Publier l'annonce" };
  }
  switch (approval.status) {
    case "published":
      return {
        label: "Valider la modification",
        description: `Modification d'une annonce en ligne : elle y revient avec ses dates${expiresAt ? ` (fin le ${formatMorocco(expiresAt, "longDate")})` : ""} ; le vendeur est prévenu.`,
        submit: "Valider et remettre en ligne",
      };
    case "paused":
      return { label: "Valider la modification", description: "Le vendeur avait mis l'annonce en pause : elle reste en pause, il pourra la remettre en ligne. Il est prévenu par e-mail.", submit: "Valider la modification" };
    case "expired":
      return { label: "Valider la modification", description: "L'annonce a expiré : elle reste expirée, le vendeur pourra la renouveler. Il est prévenu par e-mail.", submit: "Valider la modification" };
  }
}

const REJECT = {
  label: "Refuser",
  description: "Le vendeur reçoit le motif et peut corriger puis soumettre à nouveau son annonce.",
  review: "Vérifier le refus",
  submit: "Refuser l'annonce",
};

/**
 * The recap of a rejection before it is sent (audit zone 7 P3-11, same step as the report
 * decisions): the reason, the statement the seller reads (French text; the mail follows the
 * seller's language), the moderator's words quoted as written, and what follows.
 */
export function rejectRecap(reason: RejectReasonCode, details: string): { label: string; statement: string; details: string | null; ground: string; after: string } {
  const { label, facts, ground } = REJECT_REASONS[reason];
  const text = details.trim();
  return {
    label,
    statement: `${facts.fr.charAt(0).toUpperCase()}${facts.fr.slice(1)}.`,
    details: text || null,
    ground: ground.ref,
    after: "L'annonce passe en « Refusée ». Le vendeur reçoit cet exposé des motifs par e-mail, avec le lien de recours ; il peut corriger l'annonce et la soumettre à nouveau.",
  };
}

/** Toast after the decision, from the status the API answered with. */
const DONE: Record<ModerationDecisionResponse["status"], string> = {
  published: "Annonce publiée",
  paused: "Modification validée : l'annonce reste en pause",
  expired: "Modification validée : l'annonce reste expirée",
  rejected: "Annonce refusée",
};

interface ModerationDecisionFormProps {
  listingId: string;
  /** Version the page was rendered with: a change since answers 409. */
  version: number;
  /** What an approval gives (moderationReview `approval`). */
  approval: ApprovalOutcome;
  /** Current expiry (ISO), quoted when an approved edit keeps it. */
  expiresAt: string | null;
  /** Highest risk score of the hold and of the latest screening. */
  riskScore: number;
}

/**
 * Approve or reject a held listing; one explicit submit whose label names the outcome. Nothing is
 * chosen beforehand (a held listing was held for a reason), and a high-risk approval needs a
 * confirmation box (audit zone 7 P2-2, synthesis B5).
 */
export function ModerationDecisionForm({ listingId, version, approval, expiresAt, riskScore }: ModerationDecisionFormProps) {
  const router = useRouter();
  const groupId = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const highRisk = riskScore >= CONFIRM_APPROVAL_SCORE;
  const [reason, setReason] = useState<RejectReasonCode | "">("");
  const [details, setDetails] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<{ choice?: string; reason?: string; details?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState<ModerationDecisionRequest | null>(null);
  const approveText = approveCopy(approval, expiresAt);
  const choices: { value: Choice; label: string; description: string }[] = [
    { value: "approve", label: approveText.label, description: approveText.description },
    { value: "reject", label: REJECT.label, description: REJECT.description },
  ];

  function validate(): ModerationDecisionRequest | null {
    if (choice === null) {
      setFieldError({ choice: "Choisissez d'abord de publier ou de refuser l'annonce." });
      return null;
    }
    if (choice === "approve" && highRisk && !confirmed) {
      setFieldError({ confirm: "Cochez la case pour confirmer la publication d'une annonce à risque élevé." });
      return null;
    }
    if (choice === "approve") return { action: "approve", version, ...(note.trim() ? { note: note.trim() } : {}) };
    if (!reason) {
      setFieldError({ reason: "Choisissez le motif du refus." });
      return null;
    }
    const text = details.trim();
    if (REJECT_REASONS[reason].detailsRequired && text.length < DECISION_DETAILS_MIN) {
      setFieldError({ details: `Expliquez le motif en au moins ${DECISION_DETAILS_MIN} caractères.` });
      return null;
    }
    return { action: "reject", version, reason, ...(text ? { details: text } : {}) };
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError({});
    const body = validate();
    if (!body) return;
    // A rejection is read back before it is sent: the seller receives it as written.
    if (body.action === "reject") setReviewing(body);
    else void send(body);
  }

  async function send(body: ModerationDecisionRequest) {
    setLoading(true);
    try {
      const result = await adminFetch<ModerationDecisionResponse>(`${MODERATION_API}/${encodeURIComponent(listingId)}`, { method: "POST", csrf: true, body });
      decisionToast({ title: DONE[result?.status ?? (body.action === "approve" ? approval.status : "rejected")], description: "Le vendeur est prévenu par e-mail", decisionId: result?.decisionId, navigate: router.push });
      router.push("/moderation");
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, MESSAGES));
      setReviewing(null);
      setLoading(false);
    }
  }

  const recap = reviewing?.action === "reject" ? rejectRecap(reviewing.reason, reviewing.details ?? "") : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <h2 id={groupId} className="text-lg font-semibold">
        Décision
      </h2>
      <fieldset disabled={reviewing !== null || loading} className="flex min-w-0 flex-col gap-4">
        <div role="radiogroup" aria-labelledby={groupId} className="grid gap-2">
          {choices.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-md border p-3 transition-colors",
                choice === option.value ? (option.value === "approve" ? "border-structure bg-structure/5" : "border-danger bg-danger-surface") : "border-border hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="decision"
                value={option.value}
                checked={choice === option.value}
                onChange={() => {
                  setChoice(option.value);
                  setFieldError({});
                }}
                className="mt-1 size-4 accent-current"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-sm text-foreground-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        {fieldError.choice ? <InlineError>{fieldError.choice}</InlineError> : null}

        {choice === null ? null : choice === "approve" ? (
          <>
            {highRisk ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-warning bg-warning-surface p-3">
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input type="checkbox" name="confirm" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} aria-invalid={fieldError.confirm ? true : undefined} className="mt-0.5 size-4 shrink-0 accent-current" />
                  <span>
                    Score de risque {riskScore} sur 100 : j&apos;ai vérifié chaque signal et le contenu de l&apos;annonce, la publication est justifiée.
                  </span>
                </label>
                {fieldError.confirm ? <InlineError>{fieldError.confirm}</InlineError> : null}
              </div>
            ) : null}
            <Field label="Note interne" hint="Gardée dans le dossier de la décision, jamais envoyée au vendeur.">
              <textarea name="note" rows={2} maxLength={DECISION_TEXT_MAX} value={note} onChange={(event) => setNote(event.target.value)} className={cn(inputClassName, "h-auto min-h-16 py-2")} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Motif" required error={fieldError.reason}>
              <select name="reason" value={reason} onChange={(event) => setReason(event.target.value as RejectReasonCode | "")} className={inputClassName}>
                <option value="">Choisir un motif</option>
                {REJECT_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {REJECT_REASONS[code].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Précision pour le vendeur"
              required={reason !== "" && REJECT_REASONS[reason].detailsRequired === true}
              error={fieldError.details}
              hint="Envoyée telle quelle au vendeur avec le motif. Aucune donnée personnelle."
            >
              <textarea name="details" rows={3} maxLength={DECISION_TEXT_MAX} value={details} onChange={(event) => setDetails(event.target.value)} className={cn(inputClassName, "h-auto min-h-20 py-2")} />
            </Field>
          </>
        )}
      </fieldset>

      {error ? <ErrorBanner title={error} /> : null}
      {recap ? (
        <div role="group" aria-label="Récapitulatif avant le refus" className="flex flex-col gap-3 rounded-md border border-border-strong p-4">
          <h3 className="font-medium">Avant d&apos;envoyer le refus</h3>
          <dl className="flex flex-col gap-2.5 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-muted">Motif</dt>
              <dd>
                {recap.label} <span className="text-foreground-muted">({recap.ground})</span>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-muted">Ce que lit le vendeur</dt>
              <dd className="flex flex-col gap-1.5 border-s-2 border-danger/40 ps-3">
                <p className="text-pretty">{recap.statement}</p>
                {recap.details ? (
                  <p dir="auto" className="text-pretty whitespace-pre-line">
                    « {recap.details} »
                  </p>
                ) : (
                  <p className="text-foreground-muted">Sans précision de votre part.</p>
                )}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-foreground-muted">{recap.after}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" loading={loading} onClick={() => reviewing && void send(reviewing)}>
              {REJECT.submit}
            </Button>
            <Button type="button" variant="outline" disabled={loading} onClick={() => setReviewing(null)}>
              Modifier
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" variant={choice === "reject" ? "danger" : "structure"} loading={loading} disabled={choice === null}>
          {choice === null ? "Choisissez une décision" : choice === "approve" ? approveText.submit : REJECT.review}
        </Button>
      )}
    </form>
  );
}
