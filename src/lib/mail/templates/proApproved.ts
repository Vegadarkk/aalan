import type { TemplateData } from "../types";
import { formatDay, GREETING, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Pro application validated by a moderator (phase 7 design §4). The claims changed, so every
// session of the account was revoked: the mail says to sign in again. A shop that took a seat of
// the launch offer (owner, 2026-11-05) gets Essentiel free until `offerEndsAt`, with `noticeDays`
// of notice before any payment (and never before sales open).

interface Copy {
  subject: (shop: string) => string;
  title: string;
  body: (shop: string) => string[];
  offer: (days: number, day: string | null) => string;
  noPlan: string;
  button: string;
  closing: string;
}

const COPY: Record<MailLocale, Copy> = {
  fr: {
    subject: (shop) => `Votre compte Pro « ${shop} » est validé`,
    title: "Compte Pro validé",
    body: (shop) => [`Nous avons vérifié les informations et les pièces de « ${shop} » : votre compte Pro est validé.`, "Reconnectez-vous pour accéder à votre espace Pro et publier en tant que professionnel."],
    offer: (days, day) =>
      day
        ? `En tant que l'un des premiers Pros d'Aalan, l'offre Essentiel vous est offerte jusqu'au ${day} : vous serez prévenu ${days} jours avant tout paiement.`
        : `En tant que l'un des premiers Pros d'Aalan, l'offre Essentiel vous est offerte : vous serez prévenu ${days} jours avant tout paiement.`,
    noPlan: "Choisissez une offre depuis votre espace Pro pour publier vos annonces en tant que professionnel.",
    button: "Ouvrir mon espace Pro",
    closing: "Aalan ne vous demandera jamais de paiement par message et n'envoie aucun lien de paiement par e-mail.",
  },
  ar: {
    subject: (shop) => `تم اعتماد حسابك المهني «${shop}»`,
    title: "تم اعتماد الحساب المهني",
    body: (shop) => [`راجعنا معلومات ووثائق «${shop}»، وتم اعتماد حسابك المهني.`, "أعد تسجيل الدخول للوصول إلى فضائك المهني والنشر بصفتك مهنيًا."],
    offer: (days, day) =>
      day
        ? `بصفتك من أوائل المهنيين على أعلان، باقة Essentiel مجانية لك إلى غاية ${day}، وسنخبرك قبل ${days} يومًا من أي دفع.`
        : `بصفتك من أوائل المهنيين على أعلان، باقة Essentiel مجانية لك، وسنخبرك قبل ${days} يومًا من أي دفع.`,
    noPlan: "اختر باقة من فضائك المهني لنشر إعلاناتك بصفتك مهنيًا.",
    button: "فتح فضائي المهني",
    closing: "لن تطلب منك أعلان أي دفع عبر الرسائل ولا ترسل روابط دفع عبر البريد الإلكتروني.",
  },
};

export function proApproved(data: TemplateData["proApproved"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject(data.shopName),
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: [...copy.body(data.shopName), data.launchOffer ? copy.offer(data.noticeDays, data.offerEndsAt ? formatDay(data.offerEndsAt, ctx.lang) : null) : copy.noPlan],
    action: { label: copy.button, url: pageUrl(ctx, "pro") },
    closing: [copy.closing],
  });
}
