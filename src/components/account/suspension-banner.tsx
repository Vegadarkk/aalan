import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { numbersLocale } from "@/i18n/params";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";

// Suspended account (audit zone 7 P2-4): every account page says so, with the end of the
// suspension in Morocco's time and the way to the decision and its appeal (/recours lists the
// account's decisions with their reasons). On the deposit pages it replaces the wizard: posting is
// refused by the API anyway, so the member learns it before typing anything. Server component.

export interface SuspensionBannerProps {
  locale: Locale;
  /** End of the suspension; null when the suspension document could not be read. */
  until: Date | null;
  /** The deposit wizard was asked for: say that posting resumes at the end. */
  deposit?: boolean;
}

export async function SuspensionBanner({ locale, until, deposit = false }: SuspensionBannerProps) {
  const t = await getTranslations({ locale, namespace: "Suspension" });
  const date = until ? new Intl.DateTimeFormat(numbersLocale(locale), { dateStyle: "long", timeStyle: "short", timeZone: moroccoTimeZone(until.getTime()) }).format(until) : null;
  return (
    <Container className={deposit ? "max-w-2xl py-10 lg:py-14" : "pt-6"}>
      <section role="status" aria-labelledby="suspension-title" data-testid="suspension-banner" className="flex gap-3 rounded-lg border border-warning/30 bg-warning-surface p-4 text-foreground sm:p-5">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id="suspension-title" className="font-semibold">
            {t("title")}
          </h2>
          <p className="text-sm text-pretty">{date ? t("bodyUntil", { date }) : t("body")}</p>
          {deposit ? <p className="text-sm text-pretty">{t("deposit")}</p> : null}
          <Link href="/recours" className="text-sm font-medium text-link underline underline-offset-4 hover:no-underline">
            {t("appeal")}
          </Link>
        </div>
      </section>
    </Container>
  );
}
