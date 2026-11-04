"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, KeyRound, LinkIcon, MailCheck, TimerOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { z } from "@/lib/zod";
import { Button } from "@/components/ui/button";
import { quietLinkClassName } from "@/components/ui/text-link";
import { KhatamLoader } from "@/components/ui/khatam-loader";
import { Link } from "@/i18n/navigation";
import { apiPost, isApiError, safeNextPath, setSession } from "@/lib/auth/client";
import { splitNextPath } from "@/lib/auth/next-path";
import { AUTH_API, loginSchema, passwordSchema, type ActionResponse, type SessionSummary } from "@/lib/contracts/auth";
import { cn } from "@/lib/utils";
import { markWelcomeSeen, queueDoorOpening } from "@/lib/welcome/flags";
import { FormMessage, useApiErrorMessage, useFieldMessage } from "./form-message";
import { PasswordField } from "./password-field";
import { ResendVerification } from "./resend-verification";
import { StatusPanel } from "./status-panel";
import { TurnstileWidget, type TurnstileHandle } from "./turnstile-widget";
import { useHydrated } from "./use-hydrated";

// /action?mode=verifyEmail|resetPassword&oobCode=...: the code is read in the browser and posted
// to /api/auth/action, never fetched server side (it stays out of logs and caches). Once read, it is
// also removed from the address bar and the history entry: the single-use code should not survive a
// reload, a shared screenshot or the browser history. A verification link opened on another device
// than the sign-up's asks for the account password before the code is applied (audit A-1).

type Mode = "verifyEmail" | "resetPassword";

type State =
  | { kind: "missing" }
  | { kind: "working" }
  | { kind: "verified"; session: SessionSummary | null }
  | { kind: "password"; email: string }
  | { kind: "reset"; email: string }
  | { kind: "resetDone" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "failed"; error: unknown };

function readMode(value: string | null): Mode | null {
  return value === "verifyEmail" || value === "resetPassword" ? value : null;
}

export function ActionView({ nonce }: { nonce?: string }) {
  const params = useSearchParams();
  // Read once: the URL is cleaned right after, so the search params must not be re-read.
  const [{ mode, oobCode, next }] = useState(() => ({ mode: readMode(params.get("mode")), oobCode: params.get("oobCode"), next: safeNextPath(params.get("next")) }));
  const t = useTranslations("Auth.action");
  const [state, setState] = useState<State>(() => (mode && oobCode ? { kind: "working" } : { kind: "missing" }));
  const started = useRef(false);

  const onVerified = useCallback((session: SessionSummary | null) => {
    if (session) {
      setSession(session);
      // A member's device: the home page no longer greets it with the welcome screen.
      markWelcomeSeen();
    }
    setState({ kind: "verified", session });
  }, []);

  /** True when the error was about the code itself (used, expired): the page shows that instead. */
  const onCodeError = useCallback((error: unknown): boolean => {
    if (isApiError(error, "invalid_code")) setState({ kind: "invalid" });
    else if (isApiError(error, "expired_code")) setState({ kind: "expired" });
    else return false;
    return true;
  }, []);

  const run = useCallback(async () => {
    if (!mode || !oobCode) return;
    setState({ kind: "working" });
    try {
      const answer = await apiPost<ActionResponse>(AUTH_API.action, { mode, oobCode });
      if (answer.status === "verified") onVerified(answer.session);
      else if (answer.status === "reset_ok") setState({ kind: "reset", email: answer.email });
      else if (answer.status === "password_required") setState({ kind: "password", email: answer.email });
      // turnstile_required only answers a request that carried a password, which this one did not.
      else setState({ kind: "failed", error: new Error(`unexpected answer ${answer.status}`) });
    } catch (error) {
      if (!onCodeError(error)) setState({ kind: "failed", error });
    }
  }, [mode, oobCode, onVerified, onCodeError]);

  useEffect(() => {
    // One call per page load (React strict mode runs effects twice in development).
    if (started.current) return;
    started.current = true;
    if (oobCode) window.history.replaceState(null, "", window.location.pathname);
    void run();
  }, [run, oobCode]);

  if (state.kind === "missing") {
    return (
      <StatusPanel icon={LinkIcon} title={t("missingTitle")} actions={<HomeLink />}>
        {t("missingBody")}
      </StatusPanel>
    );
  }
  if (state.kind === "working") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-5 py-6 text-foreground-muted">
        <KhatamLoader size="sm" />
        <span>{mode === "verifyEmail" ? t("verifying") : t("checking")}</span>
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <FormMessage
        error={state.error}
        title={t("failedTitle")}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void run()}>
            {t("retry")}
          </Button>
        }
      >
        <ApiMessage error={state.error} />
      </FormMessage>
    );
  }
  if (state.kind === "verified") {
    return (
      <StatusPanel
        icon={CircleCheck}
        title={t("verifiedTitle")}
        actions={
          state.session ? (
            <>
              {/* Back to the page the sign-up started from, first (audit zone 5 n°8, Z1-13). */}
              {next ? <ResumeLink next={next} label={t("goBack")} /> : null}
              <Button asChild variant={next ? "outline" : undefined}>
                <Link href="/parametres">{t("goSettings")}</Link>
              </Button>
              <Button asChild variant="outline">
                {/* The account is created: the door of the home page opens for it (once per device). */}
                <Link href="/" onClick={queueDoorOpening}>
                  {t("goHome")}
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild>
              <Link href={next ? { pathname: "/connexion", query: { next } } : "/connexion"}>{t("goSignIn")}</Link>
            </Button>
          )
        }
      >
        {state.session ? t("verifiedBody") : t("verifiedBodyAnonymous")}
      </StatusPanel>
    );
  }
  if (state.kind === "password" && oobCode) {
    return <VerifyPasswordForm oobCode={oobCode} email={state.email} nonce={nonce} onVerified={onVerified} onCodeError={onCodeError} />;
  }
  if (state.kind === "reset" && oobCode) {
    return <ResetPasswordForm oobCode={oobCode} email={state.email} onDone={() => setState({ kind: "resetDone" })} />;
  }
  if (state.kind === "resetDone") {
    return (
      <StatusPanel
        icon={CircleCheck}
        title={t("resetDoneTitle")}
        actions={
          <Button asChild>
            <Link href="/connexion">{t("goSignIn")}</Link>
          </Button>
        }
      >
        {t("resetDoneBody")}
      </StatusPanel>
    );
  }
  // invalid or expired
  const expired = state.kind === "expired";
  if (mode === "resetPassword") {
    return (
      <StatusPanel
        icon={expired ? TimerOff : LinkIcon}
        title={expired ? t("expiredTitle") : t("invalidTitle")}
        actions={
          <Button asChild>
            <Link href="/mot-de-passe-oublie">{t("requestNew")}</Link>
          </Button>
        }
      >
        {expired ? t("resetExpiredBody") : t("invalidBody")}
      </StatusPanel>
    );
  }
  return (
    <StatusPanel
      icon={expired ? TimerOff : LinkIcon}
      title={expired ? t("expiredTitle") : t("invalidTitle")}
      extra={<ResendVerification nonce={nonce} entry="action" className="mt-2 rounded-md bg-surface p-4" />}
    >
      {expired ? t("expiredBody") : t("invalidBody")}
    </StatusPanel>
  );
}

function ApiMessage({ error }: { error: unknown }) {
  const message = useApiErrorMessage();
  return <>{message(error)}</>;
}

function HomeLink() {
  const t = useTranslations("Auth.common");
  return (
    <Button asChild variant="outline">
      <Link href="/">{t("backHome")}</Link>
    </Button>
  );
}

const resetFormSchema = z.object({ password: passwordSchema }).strict();
type ResetForm = z.input<typeof resetFormSchema>;

function ResetPasswordForm({ oobCode, email, onDone }: { oobCode: string; email: string; onDone: () => void }) {
  const t = useTranslations("Auth.action");
  const fieldMessage = useFieldMessage();
  const apiMessage = useApiErrorMessage();
  const [serverError, setServerError] = useState<unknown>();
  const hydrated = useHydrated();
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({ resolver: zodResolver(resetFormSchema), defaultValues: { password: "" }, mode: "onTouched" });
  const password = useWatch({ control, name: "password" });

  async function onValid(values: ResetForm) {
    setServerError(undefined);
    try {
      await apiPost<{ status: "password_reset" }>(AUTH_API.resetConfirm, { oobCode, password: values.password });
      onDone();
    } catch (error) {
      if (isApiError(error, "weak_password")) setError("password", { type: "server", message: apiMessage(error) }, { shouldFocus: true });
      else setServerError(error);
    }
  }

  return (
    <form method="post" onSubmit={(event) => void handleSubmit(onValid)(event)} noValidate className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-md bg-surface-muted px-4 py-3 text-sm">
        <KeyRound className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-pretty">{t("resetLead", { email })}</span>
      </div>
      <FormMessage error={serverError} />
      <PasswordField
        label={t("newPassword")}
        autoComplete="new-password"
        required
        autoFocus
        rules={{ value: password ?? "", email }}
        error={fieldMessage("newPassword", errors.password)}
        {...register("password")}
      />
      {/* Password managers read the account from this hidden field. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Button type="submit" loading={isSubmitting} disabled={!hydrated} className="w-full">
        {t("resetSubmit")}
      </Button>
    </form>
  );
}

const verifyPasswordSchema = loginSchema.pick({ password: true, turnstileToken: true });
type VerifyPasswordValues = z.input<typeof verifyPasswordSchema>;

/**
 * Verification link opened on another device: the password chosen at sign-up proves the account is
 * this person's, with the login's protections (lock, Turnstile). Someone who does not know it (an
 * address registered by somebody else) sets a new one through the forgotten-password page, which
 * confirms the address too.
 */
function VerifyPasswordForm({
  oobCode,
  email,
  nonce,
  onVerified,
  onCodeError,
}: {
  oobCode: string;
  email: string;
  nonce?: string;
  onVerified: (session: SessionSummary | null) => void;
  onCodeError: (error: unknown) => boolean;
}) {
  const t = useTranslations("Auth.action");
  const signIn = useTranslations("Auth.signIn");
  const c = useTranslations("Auth.common");
  const fieldMessage = useFieldMessage();
  const turnstile = useRef<TurnstileHandle>(null);
  const resubmitOnToken = useRef(false);
  // One automatic retry per click: a server that keeps asking for Turnstile never loops.
  const automatic = useRef(false);
  const [serverError, setServerError] = useState<unknown>();
  const [turnstileNeeded, setTurnstileNeeded] = useState(false);
  const hydrated = useHydrated();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<VerifyPasswordValues>({ resolver: zodResolver(verifyPasswordSchema), defaultValues: { password: "" }, mode: "onTouched" });

  async function onValid(values: VerifyPasswordValues) {
    setServerError(undefined);
    try {
      const answer = await apiPost<ActionResponse>(AUTH_API.action, { mode: "verifyEmail", oobCode, password: values.password, turnstileToken: values.turnstileToken });
      if (answer.status === "verified") onVerified(answer.session);
      else if (answer.status === "turnstile_required") {
        // Several failed attempts: the widget appears and the same password goes again with its token.
        resubmitOnToken.current = !automatic.current;
        setTurnstileNeeded(true);
        turnstile.current?.reset();
      }
    } catch (error) {
      if (onCodeError(error)) return;
      if (isApiError(error, "turnstile_required", "turnstile_failed")) setTurnstileNeeded(true);
      setValue("turnstileToken", undefined);
      turnstile.current?.reset();
      if (isApiError(error, "invalid_credentials")) setError("password", { type: "server", message: t("passwordWrong") }, { shouldFocus: true });
      else setServerError(error);
    }
  }

  function onToken(token: string | null) {
    setValue("turnstileToken", token ?? undefined);
    if (token && resubmitOnToken.current) {
      resubmitOnToken.current = false;
      automatic.current = true;
      void handleSubmit(onValid)();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    automatic.current = false;
    void handleSubmit(onValid)(event);
  }

  return (
    // POST, never GET: submitted before hydration, the password must not land in the URL.
    <form method="post" onSubmit={onSubmit} noValidate aria-labelledby="action-password-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 id="action-password-title" className="flex items-center gap-2 font-semibold">
          <MailCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          {t("passwordTitle")}
        </h2>
        <p className="text-sm text-foreground-muted text-pretty">{t("passwordLead")}</p>
        <div className="flex items-center gap-3 rounded-md bg-surface-muted px-4 py-3 text-sm">
          <KeyRound className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 break-words text-pretty">{t("passwordAccount", { email })}</span>
        </div>
      </div>
      <FormMessage error={serverError} />
      {/* Password managers read the account from this field. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <PasswordField label={c("password")} autoComplete="current-password" required autoFocus error={fieldMessage("password", errors.password)} {...register("password")} />
      {turnstileNeeded ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{signIn("turnstileTitle")}</p>
            <p className="text-sm text-foreground-muted text-pretty">{signIn("turnstileBody")}</p>
          </div>
          <TurnstileWidget ref={turnstile} action="login" nonce={nonce} onToken={onToken} />
        </div>
      ) : null}
      <Button type="submit" loading={isSubmitting} disabled={!hydrated} className="w-full">
        {t("passwordSubmit")}
      </Button>
      <p className="text-sm text-foreground-muted text-pretty">
        {t("passwordUnknown")}{" "}
        <Link href="/mot-de-passe-oublie" className={cn("text-link", quietLinkClassName)}>
          {t("passwordChoose")}
        </Link>
      </p>
    </form>
  );
}

/** The page a sign-up started from, in its own language. */
function ResumeLink({ next, label }: { next: string; label: string }) {
  const target = splitNextPath(next);
  return (
    <Button asChild>
      <Link href={target.pathname} locale={target.locale ?? undefined} data-testid="action-resume">
        {label}
      </Link>
    </Button>
  );
}
