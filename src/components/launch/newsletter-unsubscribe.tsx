"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MailX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { apiPost } from "@/lib/auth/client";
import { NEWSLETTER_API } from "@/lib/contracts/endpoints";

// The "Se désinscrire" link of the opening list's e-mails (src/lib/mail/templates/newsletterCampaign.ts)
// lands on /liste-ouverture with the token in the fragment, never sent to a server log. Opening
// the page changes nothing (a mail scanner may open links); the button posts the token. The
// e-mails' List-Unsubscribe header posts to the API directly (RFC 8058).

type State = { kind: "none" } | { kind: "ask"; token: string; pending: boolean; failed: boolean } | { kind: "done" };

function takeToken(): string | null {
  const match = /^#desinscription=([A-Za-z0-9_.-]{16,1024})$/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return match[1] as string;
}

export function NewsletterUnsubscribe() {
  const t = useTranslations("Launch");
  const [state, setState] = useState<State>({ kind: "none" });
  const doneHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    function follow() {
      const token = takeToken();
      if (token) setState({ kind: "ask", token, pending: false, failed: false });
    }
    queueMicrotask(follow);
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  useEffect(() => {
    if (state.kind === "done") doneHeading.current?.focus();
  }, [state.kind]);

  async function confirm(token: string) {
    setState({ kind: "ask", token, pending: true, failed: false });
    try {
      await apiPost<void>(NEWSLETTER_API.unsubscribe, { token });
      setState({ kind: "done" });
    } catch {
      setState({ kind: "ask", token, pending: false, failed: true });
    }
  }

  const home = (
    <Button asChild variant="outline">
      <Link href="/">{t("listPage.home")}</Link>
    </Button>
  );

  if (state.kind === "done") {
    return (
      <div role="status" className="flex flex-col items-center gap-5" data-testid="newsletter-unsubscribed">
        <h1 ref={doneHeading} tabIndex={-1} className="inline-flex items-center gap-2 text-2xl font-semibold text-balance outline-none">
          <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden="true" />
          {t("newsletter.unsubscribed")}
        </h1>
        {home}
      </div>
    );
  }

  if (state.kind === "ask") {
    return (
      <div className="flex w-full flex-col items-center gap-5">
        <h1 className="text-2xl font-semibold text-balance">{t("newsletter.unsubscribeQuestion")}</h1>
        <p className="max-w-prose text-foreground-muted text-pretty">{t("listPage.body")}</p>
        {state.failed ? (
          <p role="alert" className="text-sm text-danger">
            {t("newsletter.unsubscribeFailed")}
          </p>
        ) : null}
        <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:justify-center">
          {home}
          <Button type="button" loading={state.pending} onClick={() => void confirm(state.token)} data-testid="newsletter-unsubscribe-confirm">
            <MailX aria-hidden="true" />
            {t("newsletter.unsubscribeButton")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <h1 className="text-2xl font-semibold text-balance">{t("listPage.title")}</h1>
      <p className="max-w-prose text-foreground-muted text-pretty">{t("listPage.body")}</p>
      <p className="max-w-prose text-foreground-muted text-pretty">{t("listPage.noLink")}</p>
      {home}
    </div>
  );
}
