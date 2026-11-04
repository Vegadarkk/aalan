"use client";

import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "@/lib/zod";
import { FormMessage, useApiErrorMessage, useFieldMessage } from "@/components/auth/form-message";
import { PasswordField } from "@/components/auth/password-field";
import { Section } from "@/components/auth/settings-section";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { numbersLocale } from "@/i18n/params";
import { apiDelete, apiPost, isApiError, setSession } from "@/lib/auth/client";
import { emailChangeSchema, type EmailChangeResponse } from "@/lib/contracts/account";
import type { SessionSummary } from "@/lib/contracts/auth";
import { ACCOUNT_API } from "@/lib/contracts/endpoints";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";

// Mes paramètres → Adresse e-mail (audit Z1-10): the current address, and its change in two steps
// (src/lib/account/email-change.ts). The answer never says whether the new address is free: the
// pending notice is worded "if this address can be used". A Google-only account has no password to
// confirm the request with: the section says how to get one instead of offering the form.

type EmailForm = z.input<typeof emailChangeSchema>;
type EmailInput = z.output<typeof emailChangeSchema>;

export function EmailSection({ session }: { session: SessionSummary }) {
  const t = useTranslations("Auth.settings.email");
  const hasPassword = session.providers.includes("password");
  const [editing, setEditing] = useState(false);
  const pending = session.emailChange ?? null;
  return (
    <Section id="email" title={t("title")} body={t("body")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <span className="text-sm text-foreground-muted">{t("current")}</span>
          <span className="text-start font-medium break-all" dir="ltr" data-testid="email-current">
            {session.email ?? "—"}
          </span>
        </div>
        {!hasPassword ? (
          <p className="text-sm text-pretty text-foreground-muted">{t("googleOnly")}</p>
        ) : pending ? (
          <PendingChange session={session} pending={pending} />
        ) : editing ? (
          <EmailChangeForm session={session} onClose={() => setEditing(false)} />
        ) : (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setEditing(true)}>
            {t("change")}
          </Button>
        )}
      </div>
    </Section>
  );
}

function PendingChange({ session, pending }: { session: SessionSummary; pending: NonNullable<SessionSummary["emailChange"]> }) {
  const t = useTranslations("Auth.settings.email");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const until = new Date(pending.expiresAt);
  const date = new Intl.DateTimeFormat(numbersLocale(locale), { dateStyle: "long", timeStyle: "short", timeZone: moroccoTimeZone(until.getTime()) }).format(until);

  async function cancel() {
    setBusy(true);
    setError(undefined);
    try {
      await apiDelete<EmailChangeResponse>(ACCOUNT_API.email);
      setSession({ ...session, emailChange: null });
      toast.success(t("cancelled"));
    } catch (cause) {
      setError(cause);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-muted p-4" data-testid="email-pending">
      <p className="flex items-start gap-3 text-sm text-pretty">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <span>
          {t.rich("pendingBody", {
            email: () => (
              <bdi dir="ltr" className="font-medium">
                {pending.newEmail}
              </bdi>
            ),
            date,
          })}
        </span>
      </p>
      <p className="text-sm text-pretty text-foreground-muted">{t("pendingHint")}</p>
      <FormMessage error={error} />
      <Button type="button" variant="ghost" size="sm" className="w-fit" loading={busy} onClick={() => void cancel()}>
        {t("cancel")}
      </Button>
    </div>
  );
}

function EmailChangeForm({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const t = useTranslations("Auth.settings.email");
  const fieldMessage = useFieldMessage();
  const apiMessage = useApiErrorMessage();
  const [serverError, setServerError] = useState<unknown>();
  const first = useRef<HTMLInputElement | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EmailForm, unknown, EmailInput>({ resolver: zodResolver(emailChangeSchema), defaultValues: { newEmail: "", currentPassword: "" }, mode: "onTouched" });
  const { ref: newEmailRef, ...newEmailField } = register("newEmail");

  // The form replaces the button that had the focus.
  useEffect(() => first.current?.focus(), []);

  const submit = handleSubmit(async (values) => {
    setServerError(undefined);
    try {
      const answer = await apiPost<EmailChangeResponse>(ACCOUNT_API.email, values);
      if (answer.status === "pending") {
        setSession({ ...session, emailChange: { newEmail: answer.newEmail, expiresAt: answer.expiresAt } });
        toast.success(t("sent"));
      }
    } catch (error) {
      if (isApiError(error, "invalid_credentials")) setError("currentPassword", { type: "server", message: apiMessage(error) }, { shouldFocus: true });
      else if (isApiError(error, "same_email", "disposable_email")) setError("newEmail", { type: "server", message: apiMessage(error) }, { shouldFocus: true });
      else setServerError(error);
    }
  });

  return (
    <form method="post" onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label={t("formLabel")}>
      <FormMessage error={serverError} />
      <p className="text-sm text-pretty text-foreground-muted">{t("formLead")}</p>
      <Field label={t("newEmail")} error={fieldMessage("email", errors.newEmail)} required>
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          dir="ltr"
          {...newEmailField}
          ref={(element) => {
            newEmailRef(element);
            first.current = element;
          }}
        />
      </Field>
      {/* Password managers pair the password with the current account. */}
      <input type="hidden" name="username" autoComplete="username" value={session.email ?? ""} readOnly />
      <PasswordField label={t("password")} autoComplete="current-password" required error={fieldMessage("currentPassword", errors.currentPassword)} {...register("currentPassword")} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" loading={isSubmitting}>
          {t("submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
          {t("close")}
        </Button>
      </div>
    </form>
  );
}
