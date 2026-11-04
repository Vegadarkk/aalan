import type { TemplateData } from "../types";
import { formatDate, GREETING, renderLayout, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

type Role = TemplateData["staffInvite"]["role"];

const COPY: Record<
  MailLocale,
  { subject: string; title: string; roles: Record<Role, string>; body: (role: string) => string[]; expires: (until: string) => string; button: string; notYou: string }
> = {
  fr: {
    subject: "Invitation à rejoindre l'équipe Aalan",
    title: "Invitation à l'équipe Aalan",
    roles: { moderator: "modérateur·rice", admin: "administrateur·rice" },
    body: (role) => [
      `Vous êtes invité·e à rejoindre l'équipe Aalan en tant que ${role}. Acceptez l'invitation pour choisir votre mot de passe et activer votre accès au back-office.`,
      "Pour entrer, vous vous identifierez d'abord avec votre compte Google, sur lequel la validation en deux étapes doit être activée, puis avec ce mot de passe.",
    ],
    expires: (until) => `Ce lien est valable une heure, jusqu'au ${until}. Passé ce délai, demandez à l'admin qui vous a invité·e de vous renvoyer l'invitation.`,
    button: "Accepter l'invitation",
    notYou: "Si vous n'attendiez pas cette invitation, ignorez cet e-mail.",
  },
  ar: {
    subject: "دعوة للانضمام إلى فريق أعلان",
    title: "دعوة إلى فريق أعلان",
    roles: { moderator: "مشرف", admin: "مدير" },
    body: (role) => [
      `أنت مدعو للانضمام إلى فريق أعلان بصفة ${role}. اقبل الدعوة لاختيار كلمة المرور وتفعيل وصولك إلى لوحة الإدارة.`,
      "للدخول، ستتحقق أولًا من هويتك بحساب Google الخاص بك، ويجب تفعيل التحقق بخطوتين عليه، ثم بكلمة المرور هذه.",
    ],
    expires: (until) => `هذا الرابط صالح لمدة ساعة واحدة، حتى ${until}. بعد ذلك، اطلب من المدير الذي دعاك أن يرسل لك الدعوة من جديد.`,
    button: "قبول الدعوة",
    notYou: "إذا لم تكن تتوقع هذه الدعوة، فتجاهل هذا البريد الإلكتروني.",
  },
};

export function staffInvite(data: TemplateData["staffInvite"], ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang];
  const paragraphs = copy.body(copy.roles[data.role] ?? data.role);
  if (data.expiresAt) paragraphs.push(copy.expires(formatDate(data.expiresAt, ctx.locale)));
  return renderLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject,
    title: copy.title,
    greeting: GREETING[ctx.lang](data.displayName),
    paragraphs,
    action: { label: copy.button, url: data.actionUrl },
    closing: [copy.notYou],
  });
}
