import * as rootParams from "next/root-params";
import { _createCache, hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, type Locale } from "@/config/site";
import { routing } from "./routing";
import { loadMessages } from "./messages";

/**
 * One cache per process for the server translators' parsed ICU message formats and Intl
 * formatters. next-intl creates it per request (React cache), so every page parsed its messages
 * with placeholders again (~0.7 ms of CPU per page). It only maps pure formatters to their inputs
 * (message, locale, formats, time zone); `getRequestConfig` hands unknown keys to createTranslator,
 * which takes `_cache`. Checked by tests/unit/intl-cache.test.ts.
 */
const sharedIntlCache: { _cache: ReturnType<typeof _createCache> } = { _cache: _createCache() };

export default getRequestConfig(async ({ locale }) => {
  let resolved: Locale = DEFAULT_LOCALE;
  if (hasLocale(routing.locales, locale)) {
    resolved = locale;
  } else {
    // Localized pages carry [locale] as root param; the back office (French only) has none.
    const param = await rootParams.locale();
    if (hasLocale(routing.locales, param)) resolved = param;
  }
  return {
    locale: resolved,
    messages: await loadMessages(resolved),
    timeZone: "Africa/Casablanca",
    // A missing Tarifit key falls back to French (Z9); never crash a page on a missing key.
    onError() {},
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join(".");
    },
    ...sharedIntlCache,
  };
});
