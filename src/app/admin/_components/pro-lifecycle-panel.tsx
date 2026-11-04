"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { inputClassName } from "@/components/ui/input";
import { PRO_LIFECYCLE_ADMIN_API, PRO_LIFECYCLE_REASON_MIN, PRO_NOTE_MAX, type ProLifecycleAction, type ProLifecycleResponse, type ProStaffNoteView } from "@/lib/contracts/pro";
import type { ProSector } from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";
import { formatMorocco } from "../_lib/moderation-format";
import { adminFetch, errorMessage } from "./api-client";
import { SECTOR_LABEL } from "./pro-labels";

// The record of a validated shop (zone 7 audit P2-10): correct its activity with a reason, reach
// the motivated decisions on the owner's account (suspension, closure), keep notes for the team.
// Every action is journaled with its text.

const MESSAGES: Record<string, string> = {
  conflict: "La boutique a déjà cette activité, ou n'est plus validée. Rechargez la page.",
  commitments_required: "Cette activité demande que la boutique accepte ses engagements depuis son espace Pro.",
};

async function send(proId: string, body: ProLifecycleAction): Promise<ProLifecycleResponse | null> {
  return adminFetch<ProLifecycleResponse>(PRO_LIFECYCLE_ADMIN_API(proId), { method: "POST", body, csrf: true });
}

/** Activity correction of a validated shop: the sectors whose commitments the owner accepted. */
export function ProSectorForm({ proId, sector, sectors }: { proId: string; sector: ProSector; sectors: ProSector[] }) {
  const router = useRouter();
  const [next, setNext] = useState<ProSector>(sector);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next === sector) {
      setFieldError("Choisissez une autre activité.");
      return;
    }
    if (reason.trim().length < PRO_LIFECYCLE_REASON_MIN) {
      setFieldError(`Expliquez la correction en au moins ${PRO_LIFECYCLE_REASON_MIN} caractères : elle est inscrite au journal et sur la fiche.`);
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    try {
      await send(proId, { action: "sector", sector: next, reason: reason.trim() });
      toast.success(`Activité corrigée : ${SECTOR_LABEL[next] ?? next}`, { description: "La correction est inscrite au journal et dans les notes." });
      setReason("");
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, MESSAGES));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
      {error ? <ErrorBanner title={error} /> : null}
      <Field label="Activité" hint={`Actuelle : ${SECTOR_LABEL[sector] ?? sector}. Une activité d'agence n'est proposée que si la boutique a accepté ses engagements.`}>
        <select name="sector" value={next} onChange={(event) => setNext(event.target.value as ProSector)} className={inputClassName}>
          {sectors.map((value) => (
            <option key={value} value={value}>
              {SECTOR_LABEL[value] ?? value}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Motif de la correction" required error={fieldError}>
        <textarea name="reason" rows={3} maxLength={PRO_NOTE_MAX} value={reason} onChange={(event) => setReason(event.target.value)} className={cn(inputClassName, "h-auto min-h-20 py-2")} />
      </Field>
      <Button type="submit" variant="outline" size="sm" loading={busy} className="self-start">
        Corriger l&apos;activité
      </Button>
    </form>
  );
}

/** Where a shop is suspended or closed: a motivated decision on its owner's account. */
export function ProSanctionLinks({ ownerUid, decideHref }: { ownerUid: string; decideHref: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-foreground-muted">
        Suspendre ou fermer la boutique se fait par une décision motivée sur le compte de son titulaire : exposé des motifs envoyé, recours possible, échelle des sanctions. La boutique et ses annonces sont masquées pendant la suspension.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={decideHref}>Décider sur le compte</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/comptes/${encodeURIComponent(ownerUid)}`}>Sanctions et décisions du compte</Link>
        </Button>
      </div>
    </div>
  );
}

/** The team's notes on the shop, newest first, and a field to add one. */
export function ProNotes({ proId, notes }: { proId: string; notes: ProStaffNoteView[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (text.trim().length < 3) {
      setFieldError("Écrivez la note (3 caractères au moins).");
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    try {
      await send(proId, { action: "note", text: text.trim() });
      toast.success("Note ajoutée à la fiche");
      setText("");
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, MESSAGES));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {notes.length === 0 ? (
        <p className="text-foreground-muted">Aucune note sur cette boutique.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border" aria-label="Notes, les plus récentes en premier">
          {notes.map((note, index) => (
            <li key={`${note.at}-${index}`} className="flex flex-col gap-0.5 py-2">
              <span className="text-xs text-foreground-muted">
                {note.by}, <time dateTime={note.at}>{formatMorocco(note.at)}</time>
              </span>
              <p dir="auto" className="whitespace-pre-line">
                {note.text}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2" noValidate>
        {error ? <ErrorBanner title={error} /> : null}
        <Field label="Nouvelle note" hint="Visible par l'équipe seulement, inscrite au journal. Pas de donnée personnelle inutile." error={fieldError}>
          <textarea name="note" rows={3} maxLength={PRO_NOTE_MAX} value={text} onChange={(event) => setText(event.target.value)} className={cn(inputClassName, "h-auto min-h-20 py-2")} />
        </Field>
        <Button type="submit" variant="outline" size="sm" loading={busy} className="self-start">
          Ajouter la note
        </Button>
      </form>
    </div>
  );
}
