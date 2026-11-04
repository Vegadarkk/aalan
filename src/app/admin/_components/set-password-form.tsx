"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import type { StaffPasswordResponse } from "@/lib/auth/staff";
import { cn } from "@/lib/utils";
import { ADMIN_API, adminFetch, errorMessage } from "./api-client";

// First password of an invited member (link mailed by an admin or printed by create-admin.ts),
// or a later reset. The code's e-mail must be the Cloudflare Access identity of this browser; the
// page says "votre compte Google" (what the person signed in with), never the tool's name
// (audit zone 7 P3-5).

/** Same value as STAFF_PASSWORD_MIN in src/lib/auth/staff.ts (server-only module, not importable here). */
const PASSWORD_MIN = 12;

const MESSAGES: Record<string, string> = {
  invalid_code: "Ce lien d'invitation n'est plus valable. Demandez à un admin de vous renvoyer l'invitation.",
  expired_code: "Ce lien a expiré (il est valable une heure). Demandez à un admin de vous renvoyer l'invitation.",
  weak_password: `Mot de passe trop faible : ${PASSWORD_MIN} caractères au minimum, ni mot de passe courant ni suite évidente, rien de votre e-mail ou de votre nom.`,
  forbidden: "Ce lien a été envoyé à une autre adresse que celle du compte Google avec lequel vous êtes identifié·e, ou ce compte ne fait pas partie de l'équipe.",
  account_disabled: "Ce compte est désactivé. Demandez une nouvelle invitation à un admin.",
  unauthenticated: "Votre identification Google a expiré. Rechargez la page.",
  invalid_body: `Vérifiez le mot de passe (${PASSWORD_MIN} à 128 caractères).`,
};

interface PasswordInputProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  hint?: string;
  autoFocus?: boolean;
}

/** A password input with the show/hide button; both fields of the form share the state. */
function PasswordInput({ label, name, value, onChange, visible, onToggle, hint, autoFocus }: PasswordInputProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        <label htmlFor={id}>{label}</label>
        <span className="ms-0.5 text-danger" aria-hidden="true">
          *
        </span>
      </span>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          name={name}
          dir="ltr"
          autoComplete="new-password"
          maxLength={128}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoFocus={autoFocus}
          aria-required
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(inputClassName, "pe-12")}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute end-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
        </button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SetPasswordForm({ oobCode, onDone }: { oobCode: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = () => setVisible((current) => !current);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Array.from(password).length < PASSWORD_MIN) return setError(`${PASSWORD_MIN} caractères au minimum.`);
    if (password !== confirmation) return setError("Les deux mots de passe diffèrent.");
    setError(null);
    setLoading(true);
    try {
      await adminFetch<StaffPasswordResponse>(ADMIN_API.password, { method: "POST", body: { oobCode, password } });
      toast.success("Mot de passe enregistré. Connectez-vous.");
      onDone();
    } catch (cause) {
      setError(errorMessage(cause, MESSAGES));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Définir mon mot de passe</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Bienvenue dans l&apos;équipe. Choisissez le mot de passe du back-office : vous l&apos;utiliserez à chaque connexion, après votre compte Google.
        </p>
      </div>
      <PasswordInput
        label="Nouveau mot de passe"
        name="password"
        value={password}
        onChange={setPassword}
        visible={visible}
        onToggle={toggle}
        hint={`${PASSWORD_MIN} caractères au minimum. Une phrase de quelques mots est facile à retenir.`}
        autoFocus
      />
      <PasswordInput label="Confirmation" name="confirmation" value={confirmation} onChange={setConfirmation} visible={visible} onToggle={toggle} />
      {error ? <ErrorBanner title={error} /> : null}
      <Button type="submit" loading={loading} className="w-full">
        Enregistrer le mot de passe
      </Button>
    </form>
  );
}
