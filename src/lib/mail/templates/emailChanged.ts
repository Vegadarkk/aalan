import type { TemplateData } from "../types";
import { formatDate, GREETING, mailContact, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Change of address (audit Z1-10): the notice to the old address once the new one is confirmed.
// The new address is masked (this mailbox may no longer be the owner's); every session was closed.

const COPY: Record<MailLocale, { subject: string; title: string; body: (at: string, masked: string) => string[]; button: string; notYou: (contact: string) => string }> = {
  fr: {
    subject: "L'adresse e-mail de votre compte Aalan a changé",
    title: "Adresse e-mail modifiée",
    body: (at, masked) => [
      `Le ${at}, votre compte Aalan est passé à une nouvelle adresse e-mail (${masked}), confirmée depuis cette nouvelle adresse. Cette adresse-ci ne permet plus de vous connecter et ne recevra plus nos e-mails.`,
      "Par sécurité, toutes les sessions ouvertes ont été fermées.",
    ],
    button: "Nous contacter",
    notYou: (contact) => `Si vous n'êtes pas à l'origine de ce changement, écrivez-nous sans attendre à ${contact}.`,
  },
  ar: {
    subject: "تغيّر عنوان البريد الإلكتروني لحسابك على أعلان",
    title: "تم تغيير عنوان البريد الإلكتروني",
    body: (at, masked) => [
      `بتاريخ ${at}، انتقل حسابك على أعلان إلى عنوان بريد إلكتروني جديد (${masked}) تم تأكيده من هذا العنوان الجديد. لم يعد هذا العنوان يسمح بتسجيل الدخول ولن يتلقى رسائلنا بعد الآن.`,
      "لأسباب أمنية، تم إغلاق جميع الجلسات المفتوحة.",
    ],
    button: "اتصل بنا",
    notYou: (contact) => `إذا لم تكن أنت من قام بهذا التغيير، فراسلنا فورًا على ${contact}.`,
  },
};

export function emailChanged(data: TemplateData["emailChanged"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  // Latin-script addresses isolated in the Arabic copy so the punctuation stays after them.
  const isolate = (value: string) => (ctx.lang === "ar" ? `\u2066${value}\u2069` : value);
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject,
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: copy.body(formatDate(data.at, ctx.locale), isolate(data.newEmail)),
    action: { label: copy.button, url: pageUrl(ctx, "aide/contact") },
    closing: [copy.notYou(isolate(mailContact()))],
  });
}
