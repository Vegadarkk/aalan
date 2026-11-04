import type { TemplateData } from "../types";
import { formatDate, GREETING, NOT_YOU, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Change of address (audit Z1-10): the link sent to the new address. The account keeps its current
// address until this link is opened; it is valid 24 hours and once.

const COPY: Record<MailLocale, { subject: string; title: string; body: (until: string) => string[]; button: string }> = {
  fr: {
    subject: "Confirmez votre nouvelle adresse e-mail",
    title: "Nouvelle adresse e-mail",
    body: (until) => [
      "Vous avez demandé à utiliser cette adresse pour vous connecter à votre compte Aalan et pour recevoir nos e-mails.",
      `Confirmez-la avec le bouton ci-dessous avant le ${until}. Le lien ne sert qu'une fois ; d'ici là, votre adresse actuelle reste valable.`,
      "Une fois l'adresse confirmée, vous serez déconnecté de tous vos appareils : reconnectez-vous avec la nouvelle adresse.",
    ],
    button: "Confirmer ma nouvelle adresse",
  },
  ar: {
    subject: "أكّد عنوان بريدك الإلكتروني الجديد",
    title: "عنوان بريد إلكتروني جديد",
    body: (until) => [
      "طلبت استعمال هذا العنوان لتسجيل الدخول إلى حسابك على أعلان ولتلقي رسائلنا الإلكترونية.",
      `أكّده عبر الزر أدناه قبل ${until}. لا يُستعمل الرابط إلا مرة واحدة، ويبقى عنوانك الحالي صالحًا إلى ذلك الحين.`,
      "بعد تأكيد العنوان، سيتم تسجيل خروجك من جميع أجهزتك: سجّل الدخول من جديد بالعنوان الجديد.",
    ],
    button: "تأكيد عنواني الجديد",
  },
};

export function emailChangeConfirm(data: TemplateData["emailChangeConfirm"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject,
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: copy.body(formatDate(data.expiresAt, ctx.locale)),
    action: { label: copy.button, url: data.actionUrl },
    closing: [NOT_YOU[ctx.lang]],
  });
}
