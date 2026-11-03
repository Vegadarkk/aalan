import type { TemplateData } from "../types";
import { GREETING, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";
import { appealButton, appealUrl } from "./decision-statement";
import { statementParagraphs } from "./statement";

// Listing rejected (design D8): the art. 17 statement, then how to edit and resubmit.

const COPY: Record<MailLocale, { subject: (title: string) => string; title: string; body: (title: string) => string[]; button: string; closing: string }> = {
  fr: {
    subject: (title) => `Votre annonce « ${title} » n'a pas été publiée`,
    title: "Annonce refusée",
    body: (title) => [`Votre annonce « ${title} » ne peut pas être publiée en l'état.`],
    button: "Modifier mon annonce",
    closing: "Vous pouvez corriger l'annonce depuis « Mes annonces » et la soumettre à nouveau ; elle sera revue avant publication.",
  },
  ar: {
    subject: (title) => `لم يُنشر إعلانك «${title}»`,
    title: "تم رفض الإعلان",
    body: (title) => [`لا يمكن نشر إعلانك «${title}» بوضعه الحالي.`],
    button: "تعديل إعلاني",
    closing: "يمكنك تصحيح الإعلان من «إعلاناتي» وإعادة إرساله؛ ستتم مراجعته قبل النشر.",
  },
};

export function listingRejected(data: TemplateData["listingRejected"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject(data.title),
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: [...copy.body(data.title), ...statementParagraphs(data.statement, ctx.lang, data.listingId, { appealLink: Boolean(data.appealToken) })],
    action: { label: copy.button, url: pageUrl(ctx, "mes-annonces") },
    // The same signed appeal link as the other decisions (audit zone 7 P2-9).
    ...(data.appealToken ? { links: [{ label: appealButton(ctx.lang), url: appealUrl(ctx, data.appealToken) }] } : {}),
    replyTo: data.statement.redress,
    closing: [copy.closing],
  });
}
