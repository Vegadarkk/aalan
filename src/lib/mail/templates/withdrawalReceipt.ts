import type { TemplateData } from "../types";
import { formatDate, formatDay, GREETING, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Acknowledgement of a withdrawal from a credit pack on a durable medium (CGV §6; art. L221-21
// Code de la consommation, art. 36 loi 31-08): receipt number, date and time of the request, the
// pack, the unspent credits removed, the amount refunded and the latest refund date.

const COPY: Record<
  MailLocale,
  {
    subject: string;
    title: string;
    hello: string;
    received: (at: string, receipt: string) => string;
    pack: (credits: number, removed: number) => string;
    refund: (amount: string, by: string) => string;
    used: string;
    button: string;
    keep: string;
  }
> = {
  fr: {
    subject: "Accusé de réception de votre rétractation",
    title: "Rétractation reçue",
    hello: "Bonjour,",
    received: (at, receipt) => `Nous avons bien reçu le ${at} votre rétractation de l'achat d'un pack de crédits. Numéro d'accusé de réception : ${receipt}.`,
    pack: (credits, removed) => `Pack concerné : ${credits} crédits. Crédits non utilisés retirés de votre porte-monnaie : ${removed}.`,
    refund: (amount, by) => `Montant remboursé : ${amount}, sur le moyen de paiement utilisé pour l'achat, au plus tard le ${by}.`,
    used: "Les crédits déjà utilisés ne sont pas remboursés ; les crédits offerts avec le pack sont retirés en proportion (CGV, section 6).",
    button: "Voir mes rétractations",
    keep: "Conservez ce message : il vaut accusé de réception sur support durable.",
  },
  ar: {
    subject: "إشعار باستلام طلب التراجع",
    title: "تم استلام طلب التراجع",
    hello: "مرحبًا،",
    received: (at, receipt) => `توصلنا بتاريخ ${at} بطلب تراجعك عن شراء باقة نقاط. رقم الإشعار: ${receipt}.`,
    pack: (credits, removed) => `الباقة المعنية: ${credits} نقطة. النقاط غير المستعملة المسحوبة من محفظتك: ${removed}.`,
    refund: (amount, by) => `المبلغ المسترجع: ${amount}، على وسيلة الأداء المستعملة عند الشراء، في أجل أقصاه ${by}.`,
    used: "النقاط المستعملة لا تسترجع، وتسحب النقاط المهداة مع الباقة بنفس النسبة (الشروط العامة للبيع، الفقرة 6).",
    button: "عرض طلبات التراجع",
    keep: "احتفظ بهذه الرسالة: فهي إشعار بالاستلام على دعامة دائمة.",
  },
};

function money(minor: number, currency: string, lang: MailLocale): string {
  return new Intl.NumberFormat(lang === "ar" ? "ar-MA" : "fr-MA", { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

export function withdrawalReceipt(data: TemplateData["withdrawalReceipt"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: `${copy.subject} ${data.receipt}`,
    title: copy.title,
    greeting: data.displayName ? GREETING[ctx.lang](data.displayName) : copy.hello,
    paragraphs: [
      copy.received(formatDate(data.requestedAt, ctx.locale), data.receipt),
      copy.pack(data.packCredits, data.removedCredits),
      copy.refund(money(data.refundMinor, data.currency, ctx.lang), formatDay(data.refundBy, ctx.locale)),
      copy.used,
    ],
    action: { label: copy.button, url: pageUrl(ctx, "porte-monnaie/retractation") },
    closing: [copy.keep],
  });
}
