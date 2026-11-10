import type { Metadata } from "next";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { DeparturesPage } from "@/components/carriers/departures";
import { textLinkClassName } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import { pageLocale } from "@/i18n/params";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Departures" });
  return { title: t("title") };
}

// /pro/departs: « Mes départs », a Europe–Morocco carrier's departures (transporteurs/spec.md §4).
export default async function DeparturesRoute({ params }: { params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Departures" });
  // The Turnstile widget (a publication past the IP allowance) runs under the page's nonce CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <Container className="max-w-4xl py-10 lg:py-14">
      <Link href="/pro" className={cn("mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-link", textLinkClassName)}>
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
        {t("back")}
      </Link>
      <header className="mb-8 flex max-w-3xl flex-col gap-2">
        <h1 className="text-3xl font-semibold text-balance">{t("title")}</h1>
        <p className="text-foreground-muted text-pretty">{t("lead")}</p>
      </header>
      <DeparturesPage nonce={nonce} />
    </Container>
  );
}
