"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TurnstileWidget, type TurnstileHandle } from "@/components/auth/turnstile-widget";
import type { Locale } from "@/config/site";
import { ApiError, apiPost } from "@/lib/auth/client";
import { NEWSLETTER_API } from "@/lib/contracts/endpoints";

// The opening list on the countdown page (owner, 2026-11-12; src/lib/newsletter): an address, the
// anti-robot check, then "check your inbox". The e-mails' links come back to this page with their
// token in the fragment (#confirmer=, #desinscription=), never sent to a server log: a confirmation
// is posted at once, an unsubscribe waits for the visitor's click (a mail scanner may open links).

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "confirming" }
  | { kind: "confirmed" }
  | { kind: "confirm-failed" }
  | { kind: "unsubscribe"; token: string; pending: boolean; failed: boolean }
  | { kind: "unsubscribed" };

const ERROR_KEYS = { disposable_email: "disposable", invalid_body: "invalid", turnstile_failed: "robot", turnstile_required: "robot", rate_limited: "rateLimited", network: "network" } as const;
type ErrorKey = (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS] | "generic";

function errorKey(error: unknown): ErrorKey {
  if (error instanceof ApiError && Object.hasOwn(ERROR_KEYS, error.code)) return ERROR_KEYS[error.code as keyof typeof ERROR_KEYS];
  return "generic";
}

/** The link's action and token, read once from the fragment, which is then cleared. */
function takeFragment(): { action: "confirm" | "unsubscribe"; token: string } | null {
  const match = /^#(confirmer|desinscription)=([A-Za-z0-9_.-]{16,1024})$/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return { action: match[1] === "confirmer" ? "confirm" : "unsubscribe", token: match[2] as string };
}

export function NewsletterForm({ locale, privacyHref }: { locale: Locale; privacyHref: string }) {
  const t = useTranslations("Launch.newsletter");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const section = useRef<HTMLElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    function follow() {
      const link = takeFragment();
      if (!link) return;
      section.current?.scrollIntoView({ block: "center" });
      if (link.action === "unsubscribe") {
        setPhase({ kind: "unsubscribe", token: link.token, pending: false, failed: false });
        return;
      }
      setPhase({ kind: "confirming" });
      apiPost<void>(NEWSLETTER_API.confirm, { token: link.token }).then(
        () => setPhase({ kind: "confirmed" }),
        () => setPhase({ kind: "confirm-failed" }),
      );
    }
    // The fragment exists only in the browser: the server rendered the form, this swaps it after
    // hydration (a microtask, not during the effect's own render pass), and again when a link is
    // opened in a tab already on this page (only the fragment changes, nothing remounts).
    queueMicrotask(follow);
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  useEffect(() => {
    if (phase.kind === "sent" || phase.kind === "confirmed" || phase.kind === "unsubscribed") status.current?.focus();
  }, [phase.kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      setError("invalid");
      return;
    }
    if (!token) {
      setError("robot");
      return;
    }
    setError(null);
    setPhase({ kind: "sending" });
    try {
      await apiPost(NEWSLETTER_API.subscribe, { email, locale, turnstileToken: token });
      setPhase({ kind: "sent" });
    } catch (caught) {
      setError(errorKey(caught));
      setPhase({ kind: "form" });
      setToken(null);
      turnstile.current?.reset();
    }
  }

  async function unsubscribe(linkToken: string) {
    setPhase({ kind: "unsubscribe", token: linkToken, pending: true, failed: false });
    try {
      await apiPost<void>(NEWSLETTER_API.unsubscribe, { token: linkToken });
      setPhase({ kind: "unsubscribed" });
    } catch {
      setPhase({ kind: "unsubscribe", token: linkToken, pending: false, failed: true });
    }
  }

  const done = (message: string, hint?: string) => (
    <div className="launch-news-done">
      <p ref={status} tabIndex={-1} role="status" className="launch-news-status">
        <DoorStar />
        {message}
      </p>
      {hint ? <p className="launch-news-note">{hint}</p> : null}
    </div>
  );

  let body;
  if (phase.kind === "sent") body = done(t("sent"), t("sentHint"));
  else if (phase.kind === "confirmed") body = done(t("confirmed"));
  else if (phase.kind === "unsubscribed") body = done(t("unsubscribed"));
  else if (phase.kind === "confirming") body = <p className="launch-news-note" role="status">{t("confirming")}</p>;
  else if (phase.kind === "unsubscribe") {
    body = (
      <div className="launch-news-done">
        <p className="launch-news-intro">{t("unsubscribeQuestion")}</p>
        <button type="button" className="launch-news-button" disabled={phase.pending} aria-busy={phase.pending || undefined} onClick={() => void unsubscribe(phase.token)}>
          {t("unsubscribeButton")}
        </button>
        {phase.failed ? (
          <p className="launch-news-error" role="alert">
            {t("unsubscribeFailed")}
          </p>
        ) : null}
      </div>
    );
  } else {
    const sending = phase.kind === "sending";
    body = (
      <>
        {phase.kind === "confirm-failed" ? (
          <p className="launch-news-error" role="alert">
            {t("confirmFailed")}
          </p>
        ) : (
          <p className="launch-news-intro">{t("intro")}</p>
        )}
        <form className="launch-news-form" noValidate onSubmit={(event) => void submit(event)}>
          <label htmlFor={inputId} className="sr-only">
            {t("emailLabel")}
          </label>
          <div className="launch-news-field">
            <input
              id={inputId}
              type="email"
              name="email"
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              placeholder={t("placeholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error === "invalid" || error === "disposable" || undefined}
              aria-describedby={error ? errorId : undefined}
              className="launch-news-input"
            />
            <button type="submit" className="launch-news-button" disabled={sending} aria-busy={sending || undefined}>
              {t("submit")}
            </button>
          </div>
          {error ? (
            <p id={errorId} className="launch-news-error" role="alert">
              {t(`errors.${error}`)}
            </p>
          ) : null}
          <TurnstileWidget ref={turnstile} action="newsletter" cData="door" defer theme="dark" onToken={setToken} className="launch-news-robot" />
          <p className="launch-news-note">
            {t("consent")} <a href={privacyHref}>{t("privacy")}</a>
          </p>
        </form>
      </>
    );
  }

  return (
    <section ref={section} aria-labelledby="launch-news-title" className="launch-news welcome-enter" data-enter="news" data-testid="launch-newsletter">
      <h2 id="launch-news-title" className="launch-news-title">
        {t("title")}
      </h2>
      {body}
    </section>
  );
}

/** The logo's eight-pointed star, marking a done step. */
function DoorStar() {
  return (
    <svg className="launch-news-star" viewBox="56 0 16 16" aria-hidden="true" focusable="false">
      <path d="M64 1.5L65.9 3.4H68.6V6.1L70.5 8L68.6 9.9V12.6H65.9L64 14.5L62.1 12.6H59.4V9.9L57.5 8L59.4 6.1V3.4H62.1Z" />
    </svg>
  );
}
