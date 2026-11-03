import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { Locale } from "@/config/site";
import { pickMessages } from "@/i18n/client-messages";

/**
 * The messages of a public page's own client islands (src/i18n/client-messages.ts). The public
 * layout ships only its header's and footer's namespaces; a page provides what its islands read,
 * in a nested provider, which replaces the layout's messages (never merges them) for everything
 * below. A namespace both name travels once: React Server Components serialize the same object
 * once and reference it afterwards.
 */
export async function PageMessages({ locale, namespaces, children }: { locale: Locale; namespaces: readonly string[]; children: ReactNode }) {
  const messages = pickMessages(await getMessages({ locale }), namespaces);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
