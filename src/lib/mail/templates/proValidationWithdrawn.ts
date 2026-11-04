import type { TemplateData } from "../types";
import { GREETING, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Validation of a Pro shop withdrawn by an admin (zone 7 audit P2-10, owner decision 2026-11-04):
// the statement as the admin wrote it, what is hidden meanwhile, how to send a new KYBC and where
// to object. Not a refusal nor a sanction: the account stays, the shop comes back once validated.

interface Copy {
  subject: (shop: string) => string;
  title: string;
  body: (shop: string) => string;
  reason: (text: string) => string;
  hidden: string;
  resubmit: string;
  button: string;
  closing: (contact: string) => string;
}

const COPY: Record<MailLocale, Copy> = {
  fr: {
    subject: (shop) => `Votre boutique « ${shop} » doit être vérifiée à nouveau`,
    title: "Nouvelle vérification de votre boutique",
    body: (shop) => `Nous avons retiré la validation de la boutique « ${shop} » : elle doit être vérifiée à nouveau. Votre compte reste ouvert, et ce n'est pas une sanction.`,
    reason: (text) => `Motif : ${text}`,
    hidden:
      "En attendant la nouvelle validation, votre boutique n'apparaît plus sur le site ni dans l'annuaire, vos annonces publiées sont mises en pause (rien n'est supprimé) et vous ne pouvez plus publier en tant que professionnel. Votre offre en cours n'est pas modifiée.",
    resubmit: "Pour la rétablir, reconnectez-vous puis envoyez de nouveaux justificatifs depuis votre espace Pro. Dès qu'un modérateur valide la boutique, elle et vos annonces reviennent en ligne.",
    button: "Envoyer mes justificatifs",
    closing: (contact) => `Pour toute question ou pour contester ce retrait, écrivez à ${contact}.`,
  },
  ar: {
    subject: (shop) => `يجب التحقق من متجرك «${shop}» من جديد`,
    title: "تحقق جديد من متجرك",
    body: (shop) => `سحبنا اعتماد المتجر «${shop}»: يجب التحقق منه من جديد. يبقى حسابك مفتوحًا، وهذا ليس عقوبة.`,
    reason: (text) => `السبب: ${text}`,
    hidden: "إلى حين الاعتماد الجديد، لن يظهر متجرك على الموقع ولا في دليل المتاجر، وتُوقَف إعلاناتك المنشورة مؤقتًا (دون حذف أي شيء)، ولا يمكنك النشر بصفتك مهنيًا. لا يتغير اشتراكك الحالي.",
    resubmit: "لاستعادته، أعد تسجيل الدخول ثم أرسل وثائق جديدة من فضائك المهني. بمجرد أن يعتمد مشرف المتجر، يعود هو وإعلاناتك إلى الموقع.",
    button: "إرسال وثائقي",
    closing: (contact) => `لأي سؤال أو للاعتراض على هذا السحب، راسلنا على ${contact}.`,
  },
};

export function proValidationWithdrawn(data: TemplateData["proValidationWithdrawn"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject(data.shopName),
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: [copy.body(data.shopName), copy.reason(data.reason), copy.hidden, copy.resubmit],
    action: { label: copy.button, url: pageUrl(ctx, "pro") },
    replyTo: data.contact,
    closing: [copy.closing(data.contact)],
  });
}
