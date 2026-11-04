import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { UseFormRegisterReturn } from "react-hook-form";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import rif from "../../messages/rif.json";
import { ConsentFields } from "@/components/auth/consent-fields";
import { DEFAULT_LEGAL } from "@/config/legal";
import { LEGAL_VERSIONS } from "@/config/legal-versions";
import { RATE_LIMITS } from "@/config/rate-limits";
import { consentsRequestSchema, consentsSchema, googleSchema } from "@/lib/contracts/auth";
import { AUTH_API } from "@/lib/contracts/endpoints";
import { legalSource } from "@/lib/legal/sources";
import { renderTemplate } from "@/lib/legal/template";
import { legalScope } from "@/lib/legal/values";

// Sign-up consents after audit B2 (zone 8 P0, zone 1 M1): the transfers outside Morocco rest on
// the contract (loi 09-08 art. 44 pt 4), not on a required box, so sign-up shows a notice pointing
// to privacy policy §7 and keeps only the CGU box and the optional marketing box.

const field = (name: string): UseFormRegisterReturn => ({ name, onChange: async () => undefined, onBlur: async () => undefined, ref: () => undefined });
const fields = { cgu: field("cgu"), marketing: field("marketing") };

function render(node: ReactNode, locale: "fr" | "ar" = "fr"): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? ar : fr}
      timeZone="Africa/Casablanca"
      // A missing key fails the test instead of rendering its path.
      onError={(error) => {
        throw error;
      }}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

const privacy = (language: "fr" | "ar", whatsapp = false) =>
  renderTemplate(legalSource("confidentialite", language), legalScope(DEFAULT_LEGAL, { whatsapp, ads: true, adsCmpEea: true }, LEGAL_VERSIONS.confidentialite, language)).text;

/** The text of one `{#id}` section, up to the next heading of the same or a higher level. */
function section(text: string, id: string): string {
  const start = text.indexOf(`{#${id}}`);
  if (start < 0) return "";
  const level = text.lastIndexOf("\n", start);
  const hashes = /^\n?(#+)/.exec(text.slice(level))?.[1] ?? "##";
  const next = text.slice(start).search(new RegExp(`\\n#{1,${hashes.length}} `));
  return next < 0 ? text.slice(start) : text.slice(start, start + next);
}

describe("sign-up consent fields", () => {
  it("offers the CGU box and the marketing box only, unticked", () => {
    for (const locale of ["fr", "ar"] as const) {
      const html = render(<ConsentFields fields={fields} />, locale);
      expect(html.match(/<input[^>]*type="checkbox"/g)).toHaveLength(2);
      expect(html).not.toMatch(/<input[^>]*checked/);
      expect(html).not.toContain("<details");
    }
  });

  it("shows the transfers notice with a link to privacy policy §7, outside any label", () => {
    const html = render(<ConsentFields fields={fields} />);
    expect(html).toContain("Vos données sont hébergées dans l&#x27;Union européenne et certaines sont traitées par des prestataires hors du Maroc");
    expect(html).toMatch(/<a [^>]*href="\/fr\/legal\/confidentialite#transferts"[^>]*>Politique de confidentialité, §7<\/a>/);
    for (const label of html.match(/<label[^>]*>(?:(?!<\/label>).)*<\/label>/g) ?? []) expect(label).not.toContain("#transferts");
    const arabic = render(<ConsentFields fields={fields} />, "ar");
    expect(arabic).toMatch(/<a [^>]*href="\/ar\/legal\/confidentialite#transferts"[^>]*>سياسة الخصوصية، §7<\/a>/);
  });

  it("has no transfers consent message left in any language", () => {
    for (const messages of [fr, ar, rif]) {
      const keys = Object.keys(messages.Auth.consents);
      expect(keys).toContain("transfersNotice");
      expect(keys.filter((key) => key !== "transfersNotice" && key.startsWith("transfers"))).toEqual([]);
      expect("reconsent" in messages.Auth).toBe(false);
    }
  });
});

describe("consent contracts", () => {
  it("refuse a transfers field at sign-up and on POST /api/auth/consents", () => {
    expect(consentsSchema.safeParse({ cgu: true }).success).toBe(true);
    expect(consentsSchema.safeParse({ cgu: true, transfers: true }).success).toBe(false);
    expect(consentsSchema.safeParse({ marketing: true }).success).toBe(false);
    expect(googleSchema.safeParse({ credential: "x".repeat(40), consents: { cgu: true, transfers: true } }).success).toBe(false);
    expect(AUTH_API.consents).toBe("/api/auth/consents");
    expect(consentsRequestSchema.safeParse({ cgu: true }).success).toBe(true);
    expect(consentsRequestSchema.safeParse({ cguNotice: true }).success).toBe(true);
    for (const body of [{}, { transfers: true }, { cgu: true, transfers: true }, { cgu: false }]) {
      expect(consentsRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(RATE_LIMITS["consents.uid"]).toMatchObject({ key: "uid", policy: "open" });
  });
});

describe("privacy policy §7", () => {
  it("bases the transfers on the contract and never on a consent to withdraw", () => {
    for (const language of ["fr", "ar"] as const) {
      const text = section(privacy(language), "transferts");
      expect(text, language).not.toBe("");
      expect(text, language).toContain(language === "fr" ? "Exécution du contrat" : "تنفيذ العقد");
      expect(text, language).toContain(language === "fr" ? "article 44, point 4" : "المادة 44، البند 4");
      expect(text, language).toContain(language === "fr" ? "clôturez votre compte" : "أغلقوا حسابكم");
    }
    const fr7 = section(privacy("fr"), "transferts");
    expect(fr7).not.toMatch(/consentement exprès|retrait vaut pour l'avenir|retirer votre consentement aux transferts/);
    expect(fr7).toContain("Clauses contractuelles types ou certification Data Privacy Framework du prestataire");
  });

  it("lists every processor of §6.2 in the §7.2 table, Meta only while WhatsApp is live", () => {
    for (const language of ["fr", "ar"] as const) {
      for (const whatsapp of [false, true]) {
        const text = privacy(language, whatsapp);
        const table = section(text, "transferts-2");
        for (const provider of ["Firestore", "Oracle", "Hostinger", "Brevo", "Sentry", "Cloudflare", "Firebase Authentication", "Anthropic", "OpenAI", "Resend", "Stripe", "RevenueCat"]) {
          expect(section(text, "destinataires-2"), `${language} ${provider}`).toContain(provider);
          expect(table, `${language} ${provider}`).toContain(provider);
        }
        expect(table.includes("Meta"), `${language} whatsapp=${whatsapp}`).toBe(whatsapp);
      }
    }
  });

  it("is no longer a consent in the CGU either", () => {
    for (const language of ["fr", "ar"] as const) {
      const cgu = legalSource("cgu", language);
      expect(section(cgu, "comptes-3"), language).not.toMatch(language === "fr" ? /Consentement exprès aux transferts/ : /الموافقة الصريحة على نقل/);
      expect(section(cgu, "donnees-3"), language).not.toMatch(language === "fr" ? /consentement exprès/ : /موافقتكم الصريحة/);
    }
  });
});
