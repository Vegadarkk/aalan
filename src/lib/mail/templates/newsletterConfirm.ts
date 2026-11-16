import type { TemplateData } from "../types";
import { renderDoorLayout } from "./door-layout";
import { formatDate, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Double opt-in of the opening list (owner, 2026-11-12): the link adds the address; without a
// click within 48 hours nothing is kept (src/lib/newsletter). The door is still shut.

type Data = TemplateData["newsletterConfirm"];

interface Copy {
  subject: string;
  preheader: string;
  title: string;
  body: (opening: string | null) => string;
  button: string;
  closing: (expires: string) => string;
  reason: string;
}

const COPY: Record<MailLocale, Copy> = {
  fr: {
    subject: "Confirmez votre inscription à Aalan",
    preheader: "Un clic, et on vous prévient le jour de l'ouverture.",
    title: "Plus qu'un clic",
    body: (opening) =>
      opening
        ? `Confirmez votre adresse pour être prévenu de l'ouverture d'Aalan, le ${opening}, et recevoir l'annonce des places de lancement la veille.`
        : "Confirmez votre adresse pour recevoir les e-mails du lancement d'Aalan.",
    button: "Confirmer mon inscription",
    closing: (expires) => `Ce lien expire le ${expires}. Sans confirmation, nous ne gardons pas votre adresse et vous ne recevrez rien. Si vous n'avez rien demandé, ignorez cet e-mail.`,
    reason: "Vous recevez cet e-mail car votre adresse a été saisie sur aalan.ma.",
  },
  ar: {
    subject: "أكّد تسجيلك في أعلان",
    preheader: "نقرة واحدة، ونُخبرك يوم الافتتاح.",
    title: "بقيت نقرة واحدة",
    body: (opening) =>
      opening ? `أكّد عنوانك ليصلك خبر افتتاح أعلان يوم ${opening}، وإعلان أماكن الإطلاق في اليوم السابق.` : "أكّد عنوانك لتصلك رسائل إطلاق أعلان.",
    button: "تأكيد تسجيلي",
    closing: (expires) => `تنتهي صلاحية هذا الرابط يوم ${expires}. بدون تأكيد، لا نحتفظ بعنوانك ولن تصلك أي رسالة. إذا لم تطلب شيئًا، فتجاهل هذه الرسالة.`,
    reason: "تصلك هذه الرسالة لأن عنوانك أُدخل على aalan.ma.",
  },
};

export function newsletterConfirm(data: Data, ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderDoorLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject,
    preheader: copy.preheader,
    door: "closed",
    title: copy.title,
    paragraphs: [copy.body(data.opensAt ? formatDate(data.opensAt, ctx.locale) : null)],
    action: { label: copy.button, url: data.confirmUrl },
    rawLink: true,
    closing: [copy.closing(formatDate(data.expiresAt, ctx.locale))],
    reason: copy.reason,
  });
}
