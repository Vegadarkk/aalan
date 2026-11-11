import type { TemplateData } from "../types";
import { formatDay, GREETING, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// An individual's launch place (owner, 2026-11-11): the gift credits landed in the wallet, valid
// until `expiresAt`, spendable on options (bump, À la Une) even while purchases are closed.

type Data = TemplateData["launchPlaceGranted"];

interface Copy {
  subject: (credits: number) => string;
  title: string;
  body: (credits: number, day: string) => string[];
  button: string;
  closing: string;
}

const COPY: Record<MailLocale, Copy> = {
  fr: {
    subject: (credits) => `Vous avez une place de lancement : ${credits} crédits offerts`,
    title: "Votre place de lancement",
    body: (credits, day) => [
      `Merci d'avoir publié l'une des premières annonces d'Aalan. Vous faites partie des premiers inscrits : ${credits} crédits vous sont offerts.`,
      `Ils servent à mettre vos annonces en avant (remontée en tête de liste, « À la Une ») et sont valables jusqu'au ${day}. Ils ne sont ni remboursables ni transférables.`,
    ],
    button: "Mettre une annonce en avant",
    closing: "Aalan ne vous demandera jamais de paiement ni de code par message.",
  },
  ar: {
    subject: (credits) => `حصلت على مكان في الإطلاق: ${credits} نقطة مجانية`,
    title: "مكانك في الإطلاق",
    body: (credits, day) => [
      `شكرًا على نشر أحد أول الإعلانات على أعلان. أنت من أوائل المسجلين: حصلت على ${credits} نقطة مجانية.`,
      `تُستعمل لإبراز إعلاناتك (الرفع إلى رأس القائمة، «في الواجهة») وهي صالحة حتى ${day}. لا تُسترد ولا تُحوَّل.`,
    ],
    button: "إبراز إعلان",
    closing: "لن يطلب منك أعلان أبدًا أي دفع أو رمز عبر الرسائل.",
  },
};

export function launchPlaceGranted(data: Data, ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject(data.credits),
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: copy.body(data.credits, formatDay(data.expiresAt, ctx.locale)),
    action: { label: copy.button, url: pageUrl(ctx, "mes-annonces") },
    closing: [copy.closing],
  });
}
