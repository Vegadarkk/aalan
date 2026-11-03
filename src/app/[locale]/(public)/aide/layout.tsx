import type { ReactNode } from "react";
import { PageMessages } from "@/components/i18n/page-messages";
import { HELP_PAGE_CLIENT_NAMESPACES } from "@/i18n/client-messages";
import { pageLocale } from "@/i18n/params";

// Help centre (design phase-5 D25): its pages' islands read the search box, assistant widget and
// contact form namespaces (src/i18n/client-messages.ts), in the page provider that wraps every help page.

export default async function HelpLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  return (
    <PageMessages locale={locale} namespaces={HELP_PAGE_CLIENT_NAMESPACES}>
      {children}
    </PageMessages>
  );
}
