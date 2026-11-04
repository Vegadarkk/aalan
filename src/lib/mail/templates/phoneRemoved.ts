import type { TemplateData } from "../types";
import { GREETING, mailContact, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Security mail of the phone transfer (src/lib/phone-verify/inbound.ts): the number was just
// verified from the phone itself on another account, so it left this one. The contact address is
// the one of the legal config (setMailPublisher), never hardcoded.

const COPY: Record<MailLocale, { subject: string; title: string; body: (phone: string) => string[]; button: string; notYou: (contact: string) => string }> = {
  fr: {
    subject: "Votre numéro de téléphone a été retiré de votre compte",
    title: "Numéro retiré",
    body: (phone) => [
      `Le numéro ${phone} vient d'être vérifié depuis ce téléphone sur un autre compte Aalan. Il a donc été retiré de votre compte, et vos annonces n'affichent plus le badge « Téléphone vérifié ».`,
      "Si c'est bien vous (un second compte, par exemple), tout est en ordre. Vous pouvez vérifier un autre numéro à tout moment.",
    ],
    button: "Vérifier un numéro",
    notYou: (contact) => `Si ce n'est pas vous, écrivez-nous sans attendre à ${contact} depuis cette adresse e-mail : nous vérifierons avec vous.`,
  },
  ar: {
    subject: "تمت إزالة رقم هاتفك من حسابك",
    title: "تمت إزالة الرقم",
    body: (phone) => [
      `تم للتو التحقق من الرقم ${phone} من هذا الهاتف على حساب أعلان آخر. لذلك أُزيل من حسابك، ولم تعد إعلاناتك تعرض شارة «هاتف موثّق».`,
      "إذا كنت أنت من قام بذلك (حساب ثانٍ مثلًا)، فكل شيء على ما يرام. يمكنك التحقق من رقم آخر في أي وقت.",
    ],
    button: "التحقق من رقم",
    notYou: (contact) => `إذا لم تكن أنت، فراسلنا فورًا على ${contact} من عنوان بريدك الإلكتروني هذا: سنتحقق من الأمر معك.`,
  },
};

export function phoneRemoved(data: TemplateData["phoneRemoved"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  // Isolate the number and the address from the surrounding RTL text.
  const isolate = (value: string) => (ctx.lang === "ar" ? `⁦${value}⁩` : value);
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject,
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: copy.body(isolate(data.phone)),
    action: { label: copy.button, url: pageUrl(ctx, "verifications") },
    closing: [copy.notYou(isolate(mailContact()))],
  });
}
