import { LOCALE_TAGS } from "@/config/site";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";
import type { NewsletterCampaign } from "@/lib/newsletter/campaigns";
import type { TemplateData } from "../types";
import { renderDoorLayout, type DoorState } from "./door-layout";
import { formatDay, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// The three e-mails of the opening list (owner, 2026-11-16; src/lib/newsletter/campaigns.ts): the
// door opens a little more with each one. J-7 teaser (closed), J-1 launch places (ajar), the
// opening (open). The numbers of the launch places come from the live pricing configuration at
// send time. Every e-mail carries the one-click unsubscribe (RFC 8058 header to the API, and a
// footer link to the page that confirms it), and is the visitor's language: Tarifit reads French.

type Data = TemplateData["newsletterCampaign"];
type Places = NonNullable<Data["places"]>;

interface Words {
  /** "samedi 12 décembre à 10:00": the opening in the hero's small capitals. */
  when: string;
  /** "12 décembre": the opening day in a subject. */
  day: string;
  /** Last day a place is given ("12 mars 2027"), or null (no end date). */
  lastDay: string | null;
}

/** `p` is null only for the opening e-mail when no launch place is given. */
interface Copy {
  subject: (w: Words, p: Places | null) => string;
  preheader: (w: Words, p: Places | null) => string;
  label: string;
  title: (p: Places | null) => string;
  paragraphs: (w: Words, p: Places | null) => string[];
  button: string;
  closing?: string[];
}

interface Shared {
  reason: string;
  unsubscribe: string;
  /** The place of an individual and of a shop, in one sentence each. */
  individual: (p: Places) => string;
  shop: (p: Places) => string;
}

const SHARED: Record<MailLocale, Shared> = {
  fr: {
    reason: "Vous recevez cet e-mail car vous vous êtes inscrit à la liste d'ouverture d'Aalan sur aalan.ma.",
    unsubscribe: "Se désinscrire en un clic",
    individual: (p) =>
      `Particulier : votre première annonce acceptée par la modération vous donne ${p.credits} crédits offerts, valables ${p.creditDays} jours, pour remonter vos annonces ou les mettre « À la Une »${p.requirePhone ? " (numéro de téléphone vérifié requis)" : ""}.`,
    shop: (p) => `Boutique : votre boutique validée profite de l'offre Essentiel offerte pendant ${p.months} mois.`,
  },
  ar: {
    reason: "تصلك هذه الرسالة لأنك سجّلت في قائمة افتتاح أعلان على aalan.ma.",
    unsubscribe: "إلغاء الاشتراك بنقرة واحدة",
    individual: (p) =>
      `للأفراد: أول إعلان تقبله المراجعة يمنحك ${p.credits} نقطة مجانية صالحة لمدة ${p.creditDays} يومًا، لرفع إعلاناتك أو وضعها «في الواجهة»${p.requirePhone ? " (يلزم رقم هاتف موثَّق)" : ""}.`,
    shop: (p) => `للمتاجر: يستفيد متجرك بعد توثيقه من عرض «Essentiel» مجانًا لمدة ${p.months} أشهر.`,
  },
};

/** The J-1 e-mail is about the places: the job never sends it without them. */
function need(places: Places | null): Places {
  if (!places) throw new Error("newsletterCampaign: the launch places e-mail needs the places");
  return places;
}

/** "1 000" in French (narrow no-break space), "1000" in Arabic copy (Latin digits, no separator). */
function seats(places: Places | null, lang: MailLocale): string {
  const count = need(places).seats;
  return lang === "fr" ? count.toLocaleString("fr-FR") : String(count);
}

const COPY: Record<MailLocale, Record<NewsletterCampaign, Copy>> = {
  fr: {
    teaser: {
      subject: (w) => `J-7 : Aalan ouvre ses portes le ${w.day}`,
      preheader: (w) => `Les petites annonces de tout le Maroc. Rendez-vous ${w.when}.`,
      label: "J-7",
      title: () => "Dans sept jours, la porte s'ouvre",
      paragraphs: (w) => [
        "Aalan, ce sont les petites annonces de tout le Maroc au même endroit : vendre ce qui dort chez vous, acheter d'occasion, louer, trouver un professionnel près de chez vous.",
        "Déposer une annonce sera gratuit. Acheteurs et vendeurs se parlent par la messagerie d'Aalan : votre numéro reste privé.",
        `Ouverture ${w.when} (heure du Maroc). Et une surprise attend les premiers arrivés : on vous la dévoile la veille.`,
      ],
      button: "Voir le compte à rebours",
    },
    places: {
      subject: (_w, p) => `Demain : ${seats(p, "fr")} places de lancement à prendre`,
      preheader: (_w, p) => `${need(p).credits} crédits offerts aux particuliers, ${need(p).months} mois d'Essentiel offerts aux boutiques.`,
      label: "J-1",
      title: (p) => `${seats(p, "fr")} places de lancement`,
      paragraphs: (w, places) => {
        const p = need(places);
        return [
          `Aalan ouvre demain, ${w.when} (heure du Maroc). Les ${seats(p, "fr")} premiers à se lancer, particuliers et boutiques ensemble, reçoivent un cadeau de bienvenue.`,
          SHARED.fr.individual(p),
          SHARED.fr.shop(p),
          w.lastDay ? `Une place par personne, attribuée jusqu'au ${w.lastDay} ou jusqu'à ce qu'il n'en reste plus.` : "Une place par personne, attribuée jusqu'à ce qu'il n'en reste plus.",
        ];
      },
      button: "Voir le compte à rebours",
    },
    opening: {
      subject: () => "C'est ouvert : bienvenue sur Aalan",
      preheader: (_w, p) => (p ? "Déposez votre première annonce et prenez votre place de lancement." : "Créez votre compte et déposez votre première annonce."),
      label: "J",
      title: () => "La porte est ouverte",
      paragraphs: (_w, p) => [
        "Aalan est en ligne. Créez votre compte et déposez votre première annonce : c'est gratuit.",
        ...(p ? [`Les ${seats(p, "fr")} places de lancement sont ouvertes.`, SHARED.fr.individual(p), SHARED.fr.shop(p)] : []),
      ],
      button: "Déposer une annonce",
      closing: ["C'était le dernier e-mail de la liste d'ouverture : votre adresse sera effacée dans les 30 jours. Merci de nous avoir attendus."],
    },
  },
  ar: {
    teaser: {
      subject: (w) => `بقيت 7 أيام: أعلان يفتح أبوابه يوم ${w.day}`,
      preheader: (w) => `الإعلانات المبوبة لكل المغرب. الموعد ${w.when}.`,
      label: "J-7",
      title: () => "بعد سبعة أيام، يُفتح الباب",
      paragraphs: (w) => [
        "أعلان هو الإعلانات المبوبة لكل المغرب في مكان واحد: بِع ما لا تستعمله، اشترِ المستعمل، أجِّر، وابحث عن مهني قريب منك.",
        "نشر الإعلان سيكون مجانيًا. يتواصل المشترون والبائعون عبر رسائل أعلان: رقمك يبقى خاصًا.",
        `الافتتاح ${w.when} (بتوقيت المغرب). ومفاجأة تنتظر أوائل القادمين: نكشفها لك في اليوم السابق.`,
      ],
      button: "مشاهدة العد التنازلي",
    },
    places: {
      subject: (_w, p) => `غدًا: ${seats(p, "ar")} مكان في الإطلاق`,
      preheader: (_w, p) => `${need(p).credits} نقطة مجانية للأفراد، و${need(p).months} أشهر من «Essentiel» مجانًا للمتاجر.`,
      label: "J-1",
      title: (p) => `${seats(p, "ar")} مكان في الإطلاق`,
      paragraphs: (w, places) => {
        const p = need(places);
        return [
          `يفتح أعلان غدًا، ${w.when} (بتوقيت المغرب). أول ${seats(p, "ar")} من الأفراد والمتاجر معًا يحصلون على هدية ترحيب.`,
          SHARED.ar.individual(p),
          SHARED.ar.shop(p),
          w.lastDay ? `مكان واحد لكل شخص، يُمنح حتى ${w.lastDay} أو إلى أن تنفد الأماكن.` : "مكان واحد لكل شخص، يُمنح إلى أن تنفد الأماكن.",
        ];
      },
      button: "مشاهدة العد التنازلي",
    },
    opening: {
      subject: () => "فُتح الباب: مرحبًا بك في أعلان",
      preheader: (_w, p) => (p ? "انشر إعلانك الأول واحجز مكانك في الإطلاق." : "أنشئ حسابك وانشر إعلانك الأول."),
      label: "اليوم",
      title: () => "الباب مفتوح",
      paragraphs: (_w, p) => ["أعلان متاح الآن. أنشئ حسابك وانشر إعلانك الأول: النشر مجاني.", ...(p ? [`أماكن الإطلاق الـ${seats(p, "ar")} مفتوحة.`, SHARED.ar.individual(p), SHARED.ar.shop(p)] : [])],
      button: "نشر إعلان",
      closing: ["كانت هذه آخر رسالة من قائمة الافتتاح: سيُحذف عنوانك خلال 30 يومًا. شكرًا على انتظارك."],
    },
  },
};

const DOOR: Record<NewsletterCampaign, DoorState> = {
  teaser: "closed",
  places: "ajar",
  opening: "open",
};

function tagOf(lang: MailLocale): string {
  return LOCALE_TAGS[lang];
}

/** "samedi 12 décembre à 10:00", Morocco time, Latin digits. */
function when(iso: string, lang: MailLocale): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat(tagOf(lang), {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: moroccoTimeZone(at.getTime()),
    numberingSystem: "latn",
  }).format(at);
}

function day(iso: string, lang: MailLocale): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat(tagOf(lang), {
    day: "numeric",
    month: "long",
    timeZone: moroccoTimeZone(at.getTime()),
    numberingSystem: "latn",
  }).format(at);
}

/** The last day a place is given: `grantsUntil` is exclusive (a midnight), so the day before it. */
function lastDay(until: string | null, ctx: TemplateContext): string | null {
  if (!until) return null;
  const at = Date.parse(until);
  return Number.isNaN(at) ? null : formatDay(new Date(at - 12 * 3_600_000).toISOString(), ctx.locale);
}

/** Page of the footer link: it confirms the unsubscribe on a click (the token rides in the fragment). */
export function unsubscribePageUrl(siteUrl: string, locale: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/${locale}/liste-ouverture#desinscription=${token}`;
}

/** One-click endpoint of the List-Unsubscribe header. */
export function unsubscribeApiUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/api/newsletter/unsubscribe?t=${encodeURIComponent(token)}`;
}

export function newsletterCampaign(data: Data, ctx: TemplateContext): BuiltMail {
  const copy = COPY[ctx.lang][data.campaign];
  const shared = SHARED[ctx.lang];
  const words: Words = {
    when: when(data.opensAt, ctx.lang),
    day: day(data.opensAt, ctx.lang),
    lastDay: lastDay(data.places?.until ?? null, ctx),
  };
  const site = ctx.siteUrl.replace(/\/$/, "");
  const target = data.campaign === "opening" ? `${site}/${ctx.locale}/deposer` : `${site}/${ctx.locale}`;
  const built = renderDoorLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject(words, data.places),
    preheader: copy.preheader(words, data.places),
    door: DOOR[data.campaign],
    kicker: words.when,
    label: copy.label,
    title: copy.title(data.places),
    paragraphs: copy.paragraphs(words, data.places),
    action: { label: copy.button, url: target },
    ...(copy.closing ? { closing: copy.closing } : {}),
    reason: shared.reason,
    unsubscribe: {
      label: shared.unsubscribe,
      url: unsubscribePageUrl(ctx.siteUrl, ctx.locale, data.unsubscribeToken),
    },
  });
  return {
    ...built,
    headers: {
      "List-Unsubscribe": `<${unsubscribeApiUrl(ctx.siteUrl, data.unsubscribeToken)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
