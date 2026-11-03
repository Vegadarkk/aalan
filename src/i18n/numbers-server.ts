import { createTranslator } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import type { Locale } from "@/config/site";
import { numbersLocale } from "./params";

// getTranslations for a namespace whose messages print numbers or plurals (ICU `#`,
// `{count, plural}`): under "rif" the Tarifit text is formatted in French (numbersLocale:
// "1 200 annonces"), since there is no Intl data for "rif" (the runtime default would print
// "1,200"). The server twin of useNumbersTranslations (numbers.ts). Other locales get
// getTranslations itself.

async function getNumbersTranslator({ locale, namespace }: { locale: Locale; namespace?: string }) {
  const formatting = numbersLocale(locale);
  if (formatting === locale) return getTranslations({ locale, namespace: namespace as never });
  const messages = await getMessages({ locale });
  return createTranslator({
    locale: formatting,
    messages,
    // Same time zone as the request config (request.ts).
    timeZone: "Africa/Casablanca",
    namespace: namespace as never,
    // Same as the request config: a missing key prints its path, never crashes the page.
    onError() {},
    getMessageFallback: ({ namespace: ns, key }) => [ns, key].filter(Boolean).join("."),
  });
}

export const getNumbersTranslations = getNumbersTranslator as unknown as typeof getTranslations;
