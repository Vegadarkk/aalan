import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { SellerPaymentSettings } from "@/components/pro/seller-payment-settings";
import { pageLocale } from "@/i18n/params";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "SellerPayment.settings" });
  return { title: t("metaTitle") };
}

export default async function SellerPaymentPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  return (
    <Container className="max-w-3xl py-10 lg:py-14">
      <SellerPaymentSettings />
    </Container>
  );
}
