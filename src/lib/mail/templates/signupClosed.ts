import type { TemplateData } from "../types";
import { formatDay, GREETING, mailContact, NOT_YOU, pageUrl, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// Sign-up attempt on the e-mail of a closed account (audit Z1-11, §6 no enumeration): the browser
// got the same answer as a new sign-up. "You already have an account, sign in" would send the
// person to a sign-in that answers "deactivated": this mail says the account is closed, from when
// the address can serve again (the purge removes its emailIndex entry) and whom to write to for a
// reopening (the contact page). No sign-in or reset link: neither works on a closed account.

const COPY: Record<MailLocale, { subject: string; title: string; body: (closed: string, reusable: string) => string[]; reopen: (contact: string) => string; button: string }> = {
  fr: {
    subject: "Inscription impossible : votre compte Aalan est fermé",
    title: "Ce compte a été fermé",
    body: (closed, reusable) => [
      "Quelqu'un, sans doute vous, vient d'essayer de créer un compte Aalan avec cette adresse e-mail.",
      `Le compte associé à cette adresse a été fermé le ${closed}. Elle ne peut pas servir à un nouveau compte tant que nous conservons les données de l'ancien : elle pourra resservir à partir du ${reusable}.`,
    ],
    button: "Nous contacter",
    reopen: (contact) => `Pour rouvrir votre compte plutôt que d'attendre, écrivez-nous à ${contact}.`,
  },
  ar: {
    subject: "تعذّر التسجيل: حسابك على Aalan مغلق",
    title: "تم إغلاق هذا الحساب",
    body: (closed, reusable) => [
      "حاول شخص ما، وربما كنت أنت، إنشاء حساب على Aalan بعنوان البريد الإلكتروني هذا.",
      `تم إغلاق الحساب المرتبط بهذا العنوان بتاريخ ${closed}. لا يمكن استعماله لحساب جديد ما دمنا نحتفظ ببيانات الحساب القديم: يمكن استعماله من جديد ابتداءً من ${reusable}.`,
    ],
    button: "اتصل بنا",
    reopen: (contact) => `لإعادة فتح حسابك بدل الانتظار، راسلنا على ${contact}.`,
  },
};

export function signupClosed(data: TemplateData["signupClosed"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  // The address is Latin script: isolated in the Arabic copy so the full stop stays after it.
  const isolate = (value: string) => (ctx.lang === "ar" ? `\u2066${value}\u2069` : value);
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject,
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs: [...copy.body(formatDay(data.closedAt, ctx.locale), formatDay(data.reusableFrom, ctx.locale)), copy.reopen(isolate(mailContact()))],
    action: { label: copy.button, url: pageUrl(ctx, "aide/contact") },
    closing: [NOT_YOU[ctx.lang]],
  });
}

