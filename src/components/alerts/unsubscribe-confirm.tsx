"use client";

import { useEffect, useRef, useState } from "react";
import { BellOff, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { apiPost } from "@/lib/auth/client";
import { SEARCH_API } from "@/lib/contracts/search";

// The confirm button of /alertes/desabonnement (design D20): the page itself never changes
// anything (a mail scanner or a prefetch may open it); this POST with the token does. It owns the
// page's heading and paragraph so that, once done, the result replaces the question instead of
// sitting under it; focus moves to the new heading because the button that had it is gone.

export function UnsubscribeConfirm({ token, scope, title, body }: { token: string; scope: "one" | "all"; title: string; body: string }) {
  const t = useTranslations("Alerts.unsubscribe");
  const [state, setState] = useState<{ kind: "idle" | "pending" | "done" } | { kind: "failed"; error: unknown }>({ kind: "idle" });
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const done = state.kind === "done";

  useEffect(() => {
    if (done) doneHeading.current?.focus();
  }, [done]);

  async function confirm() {
    setState({ kind: "pending" });
    try {
      await apiPost<void>(SEARCH_API.unsubscribe, { token });
      setState({ kind: "done" });
    } catch (error) {
      setState({ kind: "failed", error });
    }
  }

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center gap-5" data-testid="unsubscribe-done">
        <h1 ref={doneHeading} tabIndex={-1} className="inline-flex items-center gap-2 text-2xl font-semibold text-balance outline-none">
          <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden="true" />
          {scope === "all" ? t("doneAll") : t("doneOne")}
        </h1>
        <p className="max-w-prose text-foreground-muted text-pretty">{t("doneBody")}</p>
        <Button asChild variant="outline">
          <Link href="/recherches">{t("manage")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <h1 className="text-2xl font-semibold text-balance">{title}</h1>
      <p className="max-w-prose text-foreground-muted text-pretty">{body}</p>
      {state.kind === "failed" ? <FormMessage error={state.error} className="w-full text-start" /> : null}
      <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="outline">
          <Link href="/recherches">{t("manage")}</Link>
        </Button>
        <Button type="button" loading={state.kind === "pending"} onClick={() => void confirm()} data-testid="unsubscribe-confirm">
          <BellOff aria-hidden="true" />
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}
