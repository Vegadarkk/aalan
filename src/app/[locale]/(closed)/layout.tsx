import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { isRtl, LOCALE_TAGS } from "@/config/site";
import { routing } from "@/i18n/routing";
import { readex, ruqaa, tarifitFallback } from "@/lib/fonts";
import { rootMetadata } from "@/lib/i18n/metadata";
import "@/styles/globals.css";

// Root layout of the countdown page before the opening (src/lib/launch/gate.ts): the page is the
// whole document, so none of the site's chrome (header, search, footer, session, consent) loads
// for the campaign's visitors. A public page: static, hash CSP, cacheable by the edge (§1).

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return hasLocale(routing.locales, locale) ? rootMetadata(locale) : {};
}

/** The night of the gate in the browser's chrome, whatever the theme. */
export const viewport = { themeColor: "#0f2e2f", colorScheme: "dark" };

export default async function ClosedLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={LOCALE_TAGS[locale]} dir={isRtl(locale) ? "rtl" : "ltr"} data-theme="dark" className={`${readex.variable} ${tarifitFallback.variable} ${ruqaa.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
