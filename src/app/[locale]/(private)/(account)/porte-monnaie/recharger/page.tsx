import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { PackPicker } from "@/components/payments/pack-picker";
import { pageLocale } from "@/i18n/params";
import { getLegalConfig } from "@/lib/legal/config";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Packs" });
  return { title: t("metaTitle") };
}

export default async function BuyCreditsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  const legal = await getLegalConfig();
  return (
    <Container className="max-w-3xl py-10 lg:py-14">
      <PackPicker contactEmail={legal.email} />
    </Container>
  );
}
