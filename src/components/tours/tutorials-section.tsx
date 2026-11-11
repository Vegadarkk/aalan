"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormMessage } from "@/components/auth/form-message";
import { Section } from "@/components/auth/settings-section";
import { SwitchField } from "@/components/post/controls/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import type { TourState } from "@/lib/tours/catalog";
import { readTourSettings, saveTourSettings } from "@/lib/tours/client";
import { cn } from "@/lib/utils";

// « Tutoriels guidés » in /parametres (owner, 2026-11-11): the switch that lets tours start by
// themselves, « Revoir tous les tutoriels » (every tour unseen again), and the tutorials page
// where each one can be replayed. Saved on the account, mirrored on this device.

export function TutorialsSection() {
  const t = useTranslations("Tours.settings");
  const [state, setState] = useState<TourState | null>(null);
  const [busy, setBusy] = useState<"off" | "reset" | null>(null);
  const [failure, setFailure] = useState<unknown>();

  useEffect(() => {
    let live = true;
    void readTourSettings(true).then((settings) => live && setState(settings));
    return () => {
      live = false;
    };
  }, []);

  async function change(next: { off?: boolean; reset?: boolean }) {
    setBusy(next.reset ? "reset" : "off");
    setFailure(undefined);
    try {
      const saved = await saveTourSettings(next, true);
      setState(saved);
      toast.success(next.reset ? t("resetDone") : t(saved.off ? "off" : "on"));
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section id="tutorials" title={t("title")} body={t("body")}>
      {state ? (
        <div className="flex flex-col gap-4">
          <SwitchField label={t("label")} hint={t("hint")} checked={!state.off} disabled={busy !== null} onCheckedChange={(on) => void change({ off: !on })} className="py-0" />
          <FormMessage error={failure} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button type="button" variant="outline" size="sm" loading={busy === "reset"} disabled={busy !== null} onClick={() => void change({ reset: true })}>
              <RotateCcw aria-hidden="true" />
              {t("reset")}
            </Button>
            <Link href="/aide/tutoriels" className={cn("text-sm font-medium text-link", textLinkClassName)}>
              {t("page")}
            </Link>
          </div>
        </div>
      ) : (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-9 w-56" />
        </div>
      )}
    </Section>
  );
}
