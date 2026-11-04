import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { isRtl, LOCALE_TAGS, type Locale } from "@/config/site";
import { CguNotice } from "@/components/legal/cgu-notice";
import { Footer } from "@/components/legal/footer";
import type { PublicConfig } from "@/lib/config/public-types";
import type { SessionSummary } from "@/lib/contracts/auth";
import { getLegalConfig } from "@/lib/legal/config";
import { pickMessages } from "@/i18n/client-messages";
import { readex, ruqaa, tarifitFallback } from "@/lib/fonts";
import { Providers } from "./providers";
import { SiteHeader } from "./site-header";
import { ExamplesScript } from "@/components/examples/examples-script";
import { WelcomeScript } from "@/components/welcome/welcome-script";
import { ThemeScript } from "./theme-script";
import "@/styles/globals.css";

interface RootShellProps {
  locale: Locale;
  /** Private layout only: the request nonce for inline and third-party scripts. */
  nonce?: string;
  /** Private layout only: runtime browser configuration (public pages fetch /api/config instead). */
  config?: PublicConfig;
  /** Private layout only: the session of this request (null = anonymous), so the header renders it on first paint. */
  initialSession?: SessionSummary | null;
  /** The message namespaces the browser receives; the whole catalog when omitted (private layout). */
  clientNamespaces?: readonly string[];
  children: ReactNode;
}

/**
 * <html> of the localized root layouts. Two root layouts share it: (public), static with a
 * hash-based CSP, and (private), dynamic with the request nonce and the runtime configuration.
 */
export async function RootShell({ locale, nonce, config, initialSession, clientNamespaces, children }: RootShellProps) {
  const t = await getTranslations({ locale, namespace: "Nav" });
  const messages = clientNamespaces ? pickMessages(await getMessages({ locale }), clientNamespaces) : undefined;
  // Live config/legal (cached 5 minutes); it reads no request data, so (public) stays static (ISR).
  const { companyName } = await getLegalConfig();
  const dir = isRtl(locale) ? "rtl" : "ltr";
  return (
    <html lang={LOCALE_TAGS[locale]} dir={dir} className={`${readex.variable} ${tarifitFallback.variable} ${ruqaa.variable}`} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col antialiased search-map:h-dvh search-map:overflow-hidden">
        <ThemeScript nonce={nonce} />
        {/* Before anything paints too: the welcome threshold of a first visit to the home page. */}
        <WelcomeScript nonce={nonce} />
        {/* And whether this device hides the example listings (« Masquer les annonces exemples »). */}
        <ExamplesScript nonce={nonce} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
        >
          {t("skip")}
        </a>
        <NextIntlClientProvider messages={messages}>
          <Providers dir={dir} config={config} initialSession={initialSession}>
            <SiteHeader locale={locale} />
            <CguNotice />
            {/* A floor under short pages (an invoice or two, an empty state): the tall footer starts near
                the bottom of the screen instead of right under the content (owner, 2026-11-04), about
                7 rem of it showing. Header + category row: 7.25 rem on a phone, 8.25 rem from md. The
                search map sizes itself (h-dvh body). */}
            {/* tabIndex -1: the skip link moves the reading point too, not only the hash (no ring, globals.css). */}
            <main id="main" tabIndex={-1} className="flex min-h-[calc(100dvh-14rem)] flex-1 flex-col md:min-h-[calc(100dvh-15rem)] search-map:min-h-0">
              {children}
            </main>
            {/* Under the private root layout every footer link leads to the other root layout, a full
                page load that never reads a prefetch: none there (about 470 KB of RSC on the sign-up
                page once the footer showed, audit zone 8 perf 5). */}
            <Footer publisher={companyName} prefetch={config === undefined} />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
