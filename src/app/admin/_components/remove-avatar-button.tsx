"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ADMIN_API, adminFetch, errorMessage } from "./api-client";

const REASON_MIN = 10;
const REASON_MAX = 500;

const MESSAGES: Record<string, string> = {
  conflict: "Ce compte n'a plus de photo de profil. Rechargez la page.",
  not_found: "Ce compte n'existe plus. Rechargez la page.",
  rate_limited: "Trop de décisions en peu de temps. Réessayez dans quelques minutes.",
};

interface RemoveAvatarButtonProps {
  uid: string;
  name: string;
}

/**
 * Removes an account's profile photo (audit §7), with a confirmation dialog. The moderator's words
 * are quoted in the statement of reasons e-mailed to the member (template user.avatar.remove, with
 * the appeal link) and kept in the audit log. The account and its listings do not change.
 */
export function RemoveAvatarButton({ uid, name }: RemoveAvatarButtonProps) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const problem = reason.trim().length < REASON_MIN ? "Expliquez le motif (10 caractères au moins)." : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setError(null);
    setLoading(true);
    try {
      await adminFetch(`${ADMIN_API.users}/${encodeURIComponent(uid)}/avatar`, { method: "DELETE", csrf: true, body: { details: reason.trim() } });
      dialog.current?.close();
      toast.success(`Photo de profil retirée à ${name}`, { description: "La décision motivée lui est envoyée par e-mail, avec le lien de recours." });
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, MESSAGES));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => dialog.current?.showModal()}>
        Retirer la photo
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-foreground/40"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-balance">
            Retirer la photo de profil de {name} ?
          </h2>
          <p className="text-sm text-foreground-muted">
            La photo est supprimée ; le compte et ses annonces ne changent pas, et la personne peut envoyer une autre photo. Pour un manquement grave, décidez
            aussi une sanction.
          </p>
          <Field label="Motif" required error={touched ? problem : undefined} hint="Cité tel quel dans la décision envoyée au membre, et gardé dans le journal d'audit.">
            <textarea
              name="reason"
              rows={3}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
              className={cn(inputClassName, "h-auto min-h-20 py-2")}
            />
          </Field>
          {error ? <ErrorBanner title={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => dialog.current?.close()} disabled={loading}>
              Annuler
            </Button>
            <Button type="submit" variant="danger" size="sm" loading={loading}>
              Retirer la photo
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
