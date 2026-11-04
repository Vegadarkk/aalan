import { getTranslations } from "next-intl/server";
import { footerDirectory } from "@/components/legal/footer-directory";
import { localeParams, pageLocale } from "@/i18n/params";

// The footer's whole directory for a locale (src/components/legal/footer-directory-view.tsx):
// config and message catalogs only, built at build time, the same for every visitor. The browser
// keeps it an hour and Cloudflare a day: a deploy that renames a category shows within that time.
export const dynamicParams = false;

export function generateStaticParams() {
  return localeParams();
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }): Promise<Response> {
  const locale = pageLocale((await params).locale);
  const names = await getTranslations({ locale, namespace: "Categories" });
  return Response.json(footerDirectory(locale, (key) => names(key as Parameters<typeof names>[0])), {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" },
  });
}
