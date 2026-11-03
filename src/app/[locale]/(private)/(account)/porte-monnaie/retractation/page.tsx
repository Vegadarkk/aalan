import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { WithdrawalView } from "@/components/payments/withdrawal-view";
import { pageLocale } from "@/i18n/params";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Withdrawal" });
  return { title: t("metaTitle") };
}

/** Online withdrawal from a credit pack (CGV §6), with its acknowledgement. */
export default async function WithdrawalPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  return (
    <Container className="max-w-3xl py-10 lg:py-14">
      <WithdrawalView />
    </Container>
  );
}
