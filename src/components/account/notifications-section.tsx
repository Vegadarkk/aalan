"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { Section } from "@/components/auth/settings-section";
import { SwitchField } from "@/components/post/controls/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { apiGet, apiPost } from "@/lib/auth/client";
import type { NotificationSettings, NotificationSettingsInput } from "@/lib/contracts/account";
import { ACCOUNT_API } from "@/lib/contracts/endpoints";

// "E-mails et notifications" in /parametres (audit B2: Z1-02, zone 5 n°4): the marketing opt-in of
// the sign-up form, withdrawn or given again at any time, and the messaging e-mails. Each switch
// saves on its own; the saved-search alerts keep their switch per search in /recherches.

type Key = keyof NotificationSettingsInput;

export function NotificationsSection() {
  const t = useTranslations("Auth.settings.notifications");
  const [saved, setSaved] = useState<NotificationSettings | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    apiGet<NotificationSettings>(ACCOUNT_API.notifications).then(
      (settings) => live && setSaved(settings),
      (error: unknown) => live && setLoadError(error),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  function retry() {
    setLoadError(undefined);
    setAttempt((count) => count + 1);
  }

  return (
    <Section id="notifications" title={t("title")} body={t("body")}>
      {saved ? (
        <NotificationSwitches saved={saved} onSaved={setSaved} />
      ) : loadError ? (
        <FormMessage
          error={loadError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {t("retry")}
            </Button>
          }
        />
      ) : (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
    </Section>
  );
}

function NotificationSwitches({ saved, onSaved }: { saved: NotificationSettings; onSaved: (next: NotificationSettings) => void }) {
  const t = useTranslations("Auth.settings.notifications");
  const format = useFormatter();
  const apiMessage = useApiErrorMessage();
  const [busy, setBusy] = useState<Key | null>(null);

  async function change(key: Key, value: boolean) {
    setBusy(key);
    try {
      const next = await apiPost<NotificationSettings>(ACCOUNT_API.notifications, { [key]: value });
      onSaved(next);
      toast.success(t(`${key}.${value ? "on" : "off"}`));
    } catch (error) {
      toast.error(apiMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const since = saved.marketing && saved.marketingSince ? format.dateTime(new Date(saved.marketingSince), { dateStyle: "long", timeZone: "Africa/Casablanca" }) : null;

  return (
    <div className="flex flex-col divide-y divide-border">
      <SwitchField
        className="pt-0 pb-3"
        label={t("messagesEmail.label")}
        hint={t("messagesEmail.hint")}
        checked={saved.messagesEmail}
        disabled={busy !== null}
        onCheckedChange={(value) => void change("messagesEmail", value)}
      />
      <SwitchField
        className="py-3"
        label={t("marketing.label")}
        hint={since ? `${t("marketing.hint")} ${t("marketing.since", { date: since })}` : t("marketing.hint")}
        checked={saved.marketing}
        disabled={busy !== null}
        onCheckedChange={(value) => void change("marketing", value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-foreground-muted text-pretty">
          <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("alerts.body")}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/recherches">{t("alerts.action")}</Link>
        </Button>
      </div>
      <p className="pt-3 text-xs text-foreground-muted text-pretty">{t("always")}</p>
    </div>
  );
}
