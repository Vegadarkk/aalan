import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import rif from "../../messages/rif.json";
import { ExportError } from "@/components/account/account-sections";
import { FormMessage } from "@/components/auth/form-message";
import type { Locale } from "@/config/site";
import { ApiError } from "@/lib/auth/client";

// Zone 1 Z1-23: the fourth export of the day names the daily limit, not "Trop de tentatives".
// Zone 1 Z1-15: the sign-in lock is on this device (account + IP), never the account as a whole.

const MESSAGES = { fr, ar, rif } as const;

function html(node: React.ReactNode, locale: Locale = "fr") {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {node}
    </NextIntlClientProvider>,
  );
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();

describe("ExportError", () => {
  it("names the daily limit and when it lifts", () => {
    const shown = text(html(<ExportError error={new ApiError(429, "rate_limited", { retryAfter: 86_400 })} />));
    expect(shown).toBe("Vous avez atteint la limite de trois téléchargements par jour. Réessayez dans 24 heures.");
    expect(shown).not.toContain("Trop de tentatives");
  });

  it("falls back to a vague delay without Retry-After, in every locale", () => {
    for (const locale of ["fr", "ar", "rif"] as const) {
      const shown = text(html(<ExportError error={new ApiError(429, "rate_limited")} />, locale));
      const expected = MESSAGES[locale].Account.data.limitReached.replace("{wait}", MESSAGES[locale].Auth.common.waitLater);
      expect(shown).toBe(expected);
    }
  });

  it("leaves the other refusals to the shared wording", () => {
    expect(text(html(<ExportError error={new ApiError(503, "unavailable")} />))).toBe(fr.Auth.errors.unavailable);
    expect(html(<ExportError error={undefined} />)).toBe("");
  });
});

describe("account_locked", () => {
  it("says the device is blocked, not the account, and points to the reset", () => {
    const shown = text(html(<FormMessage error={new ApiError(429, "account_locked", { retryAfter: 900 })} />));
    expect(shown).toBe("Trop de tentatives depuis cet appareil. Réessayez dans 15 minutes, ou réinitialisez votre mot de passe.");
    for (const locale of ["fr", "ar", "rif"] as const) {
      expect(MESSAGES[locale].Auth.errors.account_locked).toContain("{wait}");
    }
    expect(fr.Auth.errors.account_locked).not.toMatch(/ce compte/);
    expect(ar.Auth.errors.account_locked).not.toContain("الحساب");
  });
});
