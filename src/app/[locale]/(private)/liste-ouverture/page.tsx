import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DoorMark } from "@/components/feedback/door-mark";
import { Container } from "@/components/layout/container";
import { NewsletterUnsubscribe } from "@/components/launch/newsletter-unsubscribe";
import { pageLocale } from "@/i18n/params";

// /liste-ouverture#desinscription=<token> (owner, 2026-11-16): the unsubscribe link of the opening
// list's e-mails. Private dynamic page (PRIVATE_SEGMENTS: nonce CSP, noindex), no session, served
// before and after the opening (OPEN_PAGE_SEGMENTS, src/lib/launch/gate.ts) since the last e-mail
// leaves at the opening. The token rides in the fragment: the server never sees it.

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Launch.listPage" });
  return { title: t("metaTitle") };
}

export default async function OpeningListPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  return (
    <Container className="max-w-xl py-12 lg:py-16">
      <section className="flex flex-col items-center gap-5 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm shadow-bab-950/5 sm:px-10" data-testid="newsletter-page">
        <DoorMark className="w-16" />
        <NewsletterUnsubscribe />
      </section>
    </Container>
  );
}
