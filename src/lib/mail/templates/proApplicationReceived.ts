import type { TemplateData } from "../types";
import { GREETING, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Acknowledgement of a Pro application (audit L4-16): received, checked by a moderator, the
// answer by e-mail. Nothing to pay meanwhile.

interface Copy {
  subject: (shop: string) => string;
  title: string;
  body: (shop: string) => string[];
  button: string;
  closing: string;
}

const COPY: Record<MailLocale, Copy> = {
  fr: {
    subject: (shop) => `Nous avons reçu la demande de compte Pro « ${shop} »`,
    title: "Demande de compte Pro reçue",
    body: (shop) => [
      `Votre demande de compte Pro pour « ${shop} » est bien arrivée.`,
      "Notre équipe vérifie vos informations et vos pièces. Vous recevrez sa décision par e-mail ; vous pouvez suivre la demande depuis votre espace Pro.",
    ],
    button: "Suivre ma demande",
    closing: "Aalan ne vous demandera jamais de paiement par message et n'envoie aucun lien de paiement par e-mail.",
  },
  ar: {
    subject: (shop) => `توصلنا بطلب الحساب المهني «${shop}»`,
    title: "توصلنا بطلب الحساب المهني",
    body: (shop) => [`وصل طلب حسابك المهني الخاص بـ«${shop}».`, "يتحقق فريقنا من معلوماتك ووثائقك. ستتوصل بقراره عبر البريد الإلكتروني، ويمكنك تتبع الطلب من فضائك المهني."],
    button: "تتبع طلبي",
    closing: "لن تطلب منك Aalan أي دفع عبر الرسائل ولا ترسل روابط دفع عبر البريد الإلكتروني.",
  },
};

export function proApplicationReceived(data: TemplateData["proApplicationReceived"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject(data.shopName),
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: copy.body(data.shopName),
    action: { label: copy.button, url: pageUrl(ctx, "pro") },
    closing: [copy.closing],
  });
}
