"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { inputClassName } from "@/components/ui/input";
import {
  PRO_LIFECYCLE_REASON_MIN,
  PRO_NOTE_MAX,
  PRO_WITHDRAW_ADMIN_API,
  PRO_WITHDRAW_STATEMENT_MAX,
  PRO_WITHDRAW_STATEMENT_MIN,
  type ProWithdrawInput,
  type ProWithdrawResponse,
} from "@/lib/contracts/pro";
import { cn } from "@/lib/utils";
import { adminFetch, errorMessage } from "./api-client";

// « Retirer la validation » of a validated shop (zone 7 audit P2-10, owner decision 2026-11-04:
// back to a new verification, not a refusal nor a sanction). Admins only. Two texts, the statement
// mailed to the Pro and the team's note, then the « Vérifier » recap before anything is sent, as
// the other decisions of the back office.

const MESSAGES: Record<string, string> = {
  conflict: "La boutique a changé depuis l'ouverture de la page (état, décision d'un autre membre de l'équipe). Rechargez la page.",
  forbidden: "Réservé aux administrateurs.",
  not_found: "Cette boutique n'existe plus.",
  rate_limited: "Trop de décisions en peu de temps. Réessayez dans quelques minutes.",
};

type Lifecycle = ProWithdrawInput["lifecycle"];

export function ProWithdrawForm({ proId, lifecycle, shopName }: { proId: string; lifecycle: Lifecycle; shopName: string }) {
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<{ statement?: string; note?: string }>({});
  const [reviewing, setReviewing] = useState<ProWithdrawInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function onReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const errors: typeof fieldError = {};
    if (statement.trim().length < PRO_WITHDRAW_STATEMENT_MIN) errors.statement = `Expliquez le motif au Pro en au moins ${PRO_WITHDRAW_STATEMENT_MIN} caractères : il le reçoit tel quel.`;
    if (note.trim().length < PRO_LIFECYCLE_REASON_MIN) errors.note = `Écrivez la note interne (${PRO_LIFECYCLE_REASON_MIN} caractères au moins) : elle reste au journal et sur la fiche.`;
    setFieldError(errors);
    if (errors.statement || errors.note) return;
    setReviewing({ statement: statement.trim(), note: note.trim(), lifecycle });
  }

  async function send(body: ProWithdrawInput) {
    setError(null);
    setLoading(true);
    try {
      const result = await adminFetch<ProWithdrawResponse>(PRO_WITHDRAW_ADMIN_API(proId), { method: "POST", body, csrf: true });
      const paused = result?.paused ?? 0;
      toast.success("Validation retirée", { description: `Boutique masquée, ${paused} annonce${paused > 1 ? "s" : ""} en pause ; le Pro est prévenu par e-mail.` });
      setReviewing(null);
      setStatement("");
      setNote("");
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, MESSAGES));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onReview} noValidate className="flex flex-col gap-3" data-testid="pro-withdraw">
      <p className="text-sm text-foreground-muted text-pretty">
        La boutique repasse en vérification : elle est masquée du site, de l&apos;annuaire et de la recherche, ses annonces publiées sont mises en pause et le compte perd ses droits Pro jusqu&apos;à une nouvelle validation KYBC. Le compte reste ouvert ; l&apos;offre en cours n&apos;est pas modifiée. Ce n&apos;est ni un refus ni une sanction.
      </p>
      <fieldset disabled={reviewing !== null || loading} className="flex min-w-0 flex-col gap-3">
        <Field label="Motif envoyé au Pro" required error={fieldError.statement} hint="Envoyé tel quel par e-mail et affiché dans son espace Pro : précis, sans donnée personnelle. Exemple : « Le registre du commerce indique une radiation de la société. »">
          <textarea name="statement" rows={4} maxLength={PRO_WITHDRAW_STATEMENT_MAX} value={statement} onChange={(event) => setStatement(event.target.value)} className={cn(inputClassName, "h-auto min-h-24 py-2")} />
        </Field>
        <Field label="Note interne" required error={fieldError.note} hint="Visible par l'équipe seulement : ajoutée aux notes de la fiche et au journal.">
          <textarea name="note" rows={3} maxLength={PRO_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} className={cn(inputClassName, "h-auto min-h-20 py-2")} />
        </Field>
      </fieldset>

      {error ? <ErrorBanner title={error} /> : null}
      {reviewing ? (
        <div role="group" aria-label="Récapitulatif avant le retrait de la validation" className="flex flex-col gap-3 rounded-md border border-border-strong p-4">
          <h4 className="font-medium">Avant de retirer la validation</h4>
          <dl className="flex flex-col gap-2.5 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-muted">Boutique</dt>
              <dd dir="auto">{shopName}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-muted">Ce que lit le Pro</dt>
              <dd dir="auto" className="border-s-2 border-danger/40 ps-3 text-pretty whitespace-pre-line">
                « {reviewing.statement} »
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-muted">Note interne</dt>
              <dd dir="auto" className="text-pretty whitespace-pre-line">
                {reviewing.note}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-foreground-muted text-pretty">Effets immédiats : boutique masquée, annonces publiées en pause, droits Pro retirés (le Pro est déconnecté), e-mail envoyé. Une nouvelle validation de ses justificatifs rétablit tout.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" loading={loading} onClick={() => void send(reviewing)}>
              Retirer la validation
            </Button>
            <Button type="button" variant="outline" disabled={loading} onClick={() => setReviewing(null)}>
              Modifier
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" variant="outline" size="sm" className="self-start">
          Vérifier le retrait
        </Button>
      )}
    </form>
  );
}
