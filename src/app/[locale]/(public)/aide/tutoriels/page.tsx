import type { Metadata } from "next";
import { FilePlus2, Palette, Store, type LucideIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { textLinkClassName } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import { getNumbersTranslations } from "@/i18n/numbers-server";
import { localeParams, pageLocale } from "@/i18n/params";
import { alternates } from "@/lib/i18n/metadata";
import { TUTORIALS, tutorialHref, tutorialStepCount, type TutorialId } from "@/lib/tours/catalog";
import { cn } from "@/lib/utils";

// Tutorials page (owner, 2026-11-11): every guided tour of the site, each one replayed on its own
// screen (`?tuto=`, src/lib/tours/client.ts). Static: the list is the catalogue's.

export function generateStaticParams() {
  return localeParams();
}

type Params = Promise<{ locale: string }>;

const ICONS: Record<TutorialId, LucideIcon> = { deposer: FilePlus2, pro: Store, boutique: Palette };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Tours.page" });
  return { title: t("metaTitle"), description: t("metaDescription"), alternates: alternates(locale, "/aide/tutoriels") };
}

export default async function TutorialsPage({ params }: { params: Params }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  const [t, tutorials, count] = await Promise.all([
    getTranslations({ locale, namespace: "Tours.page" }),
    getTranslations({ locale, namespace: "Tours.tutorials" }),
    // Prints a number: Tarifit pages format it as French (no Intl data for "rif").
    getNumbersTranslations({ locale, namespace: "Tours.page" }),
  ]);

  return (
    <>
      <section className="border-b border-border bg-surface-brand/70">
        <Container className="flex flex-col gap-4 pt-10 pb-12 sm:pt-14">
          <h1 className="text-3xl font-semibold text-balance sm:text-4xl">{t("title")}</h1>
          <p className="max-w-2xl text-lg text-pretty text-foreground-muted">{t("lead")}</p>
        </Container>
      </section>

      <Container className="py-10 sm:py-12">
        <ul className="flex max-w-3xl flex-col divide-y divide-border" data-testid="tutorials">
          {TUTORIALS.map((tutorial) => {
            const Icon = ICONS[tutorial.id];
            return (
              <li key={tutorial.id} className="flex flex-col gap-4 py-7 first:pt-0 sm:flex-row sm:items-center sm:gap-6">
                {/* A small door: the tutorial opens on its screen. */}
                <span className="arch threshold flex h-16 w-14 shrink-0 items-end justify-center bg-structure pb-3.5 text-gold-300" aria-hidden="true">
                  <Icon className="size-6" strokeWidth={1.75} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <h2 className="text-lg font-semibold text-balance">{tutorials(`${tutorial.id}.title`)}</h2>
                  <p className="text-pretty text-foreground-muted">{tutorials(`${tutorial.id}.body`)}</p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
                    <span className="tabular-nums">{count("stepCount", { count: tutorialStepCount(tutorial) })}</span>
                    {tutorial.audience === "pro" ? <Badge variant="neutral">{t("proOnly")}</Badge> : null}
                  </p>
                </div>
                <Button asChild variant="outline" className="self-start sm:self-center">
                  <Link href={tutorialHref(tutorial)} prefetch={false} data-testid={`tutorial-${tutorial.id}`}>
                    {t("start")}
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-10 flex max-w-3xl flex-col gap-1.5 border-t border-border pt-6 text-sm text-foreground-muted">
          <p className="text-pretty">{t("signIn")}</p>
          <p className="text-pretty">
            {t("settings")}{" "}
            <Link href="/parametres" prefetch={false} className={cn("font-medium text-link", textLinkClassName)}>
              {t("settingsLink")}
            </Link>
          </p>
        </div>
      </Container>
    </>
  );
}
