import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LaunchScreen, openingDate } from "@/components/launch/launch-screen";
import { pageLocale } from "@/i18n/params";
import { serverEnv } from "@/lib/env";
import { alternates, DEFAULT_OG_IMAGES } from "@/lib/i18n/metadata";
import { parseOpensAt } from "@/lib/launch/gate";
import { brandSocialLinks } from "@/lib/launch/social";
import { getLegalConfig } from "@/lib/legal/config";
import { LOCALE_TAGS, SITE_NAME } from "@/config/site";

// The home page before the opening (src/lib/launch/gate.ts): the proxy renders /{locale} with this
// page until OPENS_AT and sends /{locale}/ouverture itself to /{locale}. Rendered on its first
// request, never at build (the image has no OPENS_AT; scripts/check-prerender.ts), then kept one
// minute: the edge keeps it as long (s-maxage), so the open home replaces it within a minute of
// the opening, and the page itself reloads from zero.

export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams(): { locale: string }[] {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const opensAt = parseOpensAt(serverEnv().OPENS_AT);
  const t = await getTranslations({ locale, namespace: "Launch" });
  const date = opensAt ? openingDate(locale, opensAt) : "";
  const title = `${SITE_NAME} : ${t("metaTitle", { date })}`;
  const description = t("metaDescription", { date });
  return {
    // Its address is the home page's.
    alternates: alternates(locale),
    title: { absolute: title },
    description,
    openGraph: { title, description, siteName: SITE_NAME, locale: LOCALE_TAGS[locale].replace("-", "_"), type: "website", images: DEFAULT_OG_IMAGES },
  };
}

export default async function OpeningPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  const env = serverEnv();
  const opensAt = parseOpensAt(env.OPENS_AT);
  // Only the proxy's rewrite leads here, and only while OPENS_AT is set.
  if (!opensAt) notFound();
  const { companyName } = await getLegalConfig();
  return <LaunchScreen locale={locale} opensAt={opensAt} socials={brandSocialLinks(env.BRAND_SOCIAL_LINKS).links} publisher={companyName} />;
}
