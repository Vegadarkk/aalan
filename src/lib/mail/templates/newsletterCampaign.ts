import { LOCALE_TAGS } from "@/config/site";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";
import type { NewsletterCampaign } from "@/lib/newsletter/campaigns";
import type { TemplateData } from "../types";
import { renderDoorLayout, type DoorState } from "./door-layout";
import { formatDay, type BuiltMail, type MailLocale, type TemplateContext } from "./layout";

// The three e-mails of the opening list (owner, 2026-11-16; src/lib/newsletter/campaigns.ts): the
// door opens a little more with each one. J-7 teaser (closed), J-1 launch places (ajar), the
// opening (open). The J-1 e-mail leaves when sign-up opens and points to it. The numbers of the launch places come from the live pricing configuration at
// send time. Every e-mail carries the one-click unsubscribe (RFC 8058 header to the API, and a
// footer link to the page that confirms it), and is the visitor's language: Tarifit reads French.

type Data = TemplateData["newsletterCampaign"];
type Places = NonNullable<Data["places"]>;

interface Words {
  /** "samedi 12 décembre à 10:00": the opening in the hero's small capitals. */
  when: string;
  /** "12 décembre": the opening day in a subject. */
  day: string;
  /** "10:00": the opening time, Morocco time. */
  time: string;
  /** Last day a place is given ("12 mars 2027"), or null (no end date). */
  lastDay: string | null;
}

type Block<T> = (w: Words, p: Places | null) => T;

/** `p` is null only for the opening e-mail when no launch place is given. */
interface Copy {
  subject: Block<string>;
  preheader: Block<string>;
  label: string;
  title: Block<string>;
  paragraphs: Block<string[]>;
  points?: Block<{ lead: string; text: string }[]>;
  offers?: Block<{ who: string; figure: string; text: string }[] | undefined>;
  steps?: Block<{ when: string; text: string }[]>;
  note?: string;
  button: string;
  /** The button comes right after the opening paragraphs. */
  early?: boolean;
  /** The teaser's countdown link, under its calendar button. */
  secondary?: string;
  closing?: Block<string[]>;
  signature: string[];
}

interface Shared {
  reason: string;
  unsubscribe: string;
  /** The two launch offers, side by side. */
  offers: (p: Places) => { who: string; figure: string; text: string }[];
}

const SHARED: Record<MailLocale, Shared> = {
  fr: {
    reason: "Vous recevez cet e-mail car vous vous êtes inscrit à la liste d'ouverture d'Aalan sur aalan.ma.",
    unsubscribe: "Se désinscrire en un clic",
    offers: (p) => [
      {
        who: "Particulier",
        figure: `${p.credits} crédits`,
        text: `offerts, valables ${p.creditDays} jours, pour remonter vos annonces ou les mettre « À la Une ». Dès votre première annonce acceptée${p.requirePhone ? ", numéro de téléphone vérifié" : ""}.`,
      },
      { who: "Boutique", figure: `${p.months} mois`, text: `d'offre Essentiel offerts aux ${p.proSeats} premières boutiques, dès leur validation.` },
    ],
  },
  ar: {
    reason: "تصلك هذه الرسالة لأنك سجّلت في قائمة افتتاح أعلان على aalan.ma.",
    unsubscribe: "إلغاء الاشتراك بنقرة واحدة",
    offers: (p) => [
      {
        who: "للأفراد",
        figure: `${p.credits} نقطة`,
        text: `مجانية، صالحة لمدة ${p.creditDays} يومًا، لرفع إعلاناتك أو وضعها «في الواجهة». ابتداءً من أول إعلان تقبله المراجعة${p.requirePhone ? "، برقم هاتف موثَّق" : ""}.`,
      },
      { who: "للمتاجر", figure: `${p.months} أشهر`, text: `من عرض «Essentiel» مجانًا لأول ${p.proSeats} متجر، ابتداءً من توثيقه.` },
    ],
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
      subject: (w) => `Le ${w.day}, Aalan ouvre ses portes`,
      preheader: (w) => `Petites annonces gratuites, partout au Maroc. Rendez-vous ${w.when}.`,
      label: "J-7",
      title: () => "Dans sept jours, la porte s'ouvre",
      paragraphs: (w) => [
        "Aalan réunit les petites annonces de tout le Maroc : vendre ce qui dort chez vous, acheter d'occasion, trouver un professionnel près de chez vous.",
        "Et aussi : la location de voitures, la location de vacances, et les boutiques des pros, vérifiées avant d'ouvrir.",
        `Ouverture ${w.when} (heure du Maroc).`,
      ],
      points: () => [
        { lead: "Déposer une annonce est gratuit", text: "Photos, description, prix : tout se fait depuis votre téléphone." },
        { lead: "Votre numéro reste privé", text: "Acheteurs et vendeurs se parlent par la messagerie d'Aalan." },
        { lead: "Des annonces contrôlées", text: "Chaque annonce est vérifiée avant d'être publiée." },
      ],
      note: "Une surprise attend les premiers arrivés. On vous la dévoile la veille, ici même.",
      button: "Ajouter à mon agenda",
      secondary: "Voir le compte à rebours",
      signature: ["À très vite,", "L'équipe Aalan"],
    },
    places: {
      subject: (_w, p) => `${seats(p, "fr")} places de lancement : inscrivez-vous dès aujourd'hui`,
      preheader: (_w, p) => `${need(p).credits} crédits offerts aux particuliers, ${need(p).months} mois d'Essentiel aux boutiques. Une place par personne.`,
      label: "J-1",
      title: () => "Votre place de lancement vous attend",
      paragraphs: (w, p) => [`Aalan ouvre demain, ${w.when} (heure du Maroc). Les ${seats(p, "fr")} premiers particuliers et les ${need(p).proSeats} premières boutiques à se lancer reçoivent un cadeau de bienvenue.`],
      offers: (_w, p) => SHARED.fr.offers(need(p)),
      steps: (w, p) => [
        { when: "Dès maintenant", text: "Créez votre compte." },
        ...(need(p).requirePhone ? [{ when: "Dès maintenant", text: "Vérifiez votre numéro de téléphone." }] : []),
        { when: `Demain, ${w.time}`, text: "Publiez votre première annonce et prenez votre place." },
      ],
      button: "Créer mon compte",
      closing: (w) => [w.lastDay ? `Une place par personne, attribuée jusqu'au ${w.lastDay} ou jusqu'à épuisement.` : "Une place par personne, attribuée jusqu'à épuisement."],
      signature: ["À demain,", "L'équipe Aalan"],
    },
    opening: {
      subject: () => "C'est ouvert : déposez votre première annonce sur Aalan",
      preheader: (_w, p) => (p ? `Les ${seats(p, "fr")} places de lancement partent aux premiers arrivés.` : "Aalan est en ligne. Déposer une annonce est gratuit."),
      label: "J",
      title: () => "La porte est ouverte",
      paragraphs: (_w, p) => [
        "Aalan est en ligne. Déposer une annonce est gratuit, et les acheteurs vous écrivent par la messagerie : votre numéro reste privé.",
        "Annonces, location de voitures, location de vacances, boutiques des pros : tout est ouvert.",
        ...(p ? [`Les ${seats(p, "fr")} places de lancement sont ouvertes : votre première annonce acceptée vous donne la vôtre.`] : []),
      ],
      offers: (_w, p) => (p ? SHARED.fr.offers(p) : undefined),
      button: "Déposer ma première annonce",
      early: true,
      closing: () => ["C'était le dernier e-mail de la liste d'ouverture : votre adresse sera effacée dans les 30 jours. Merci de nous avoir attendus."],
      signature: ["Bienvenue sur Aalan,", "L'équipe Aalan"],
    },
  },
  ar: {
    teaser: {
      subject: (w) => `يوم ${w.day}، أعلان يفتح أبوابه`,
      preheader: (w) => `إعلانات مبوبة مجانية في كل المغرب. الموعد ${w.when}.`,
      label: "J-7",
      title: () => "بعد سبعة أيام، يُفتح الباب",
      paragraphs: (w) => [
        "أعلان يجمع الإعلانات المبوبة لكل المغرب في مكان واحد: بِع ما لا تستعمله، اشترِ المستعمل، وابحث عن مهني قريب منك.",
        "وأيضًا: كراء السيارات، كراء للعطل، ومتاجر المحترفين، موثّقة قبل فتحها.",
        `الافتتاح ${w.when} (بتوقيت المغرب).`,
      ],
      points: () => [
        { lead: "نشر الإعلان مجاني", text: "الصور والوصف والسعر: كل شيء من هاتفك." },
        { lead: "رقمك يبقى خاصًا", text: "يتواصل المشترون والبائعون عبر رسائل أعلان." },
        { lead: "إعلانات مراقَبة", text: "كل إعلان يُراجَع قبل نشره." },
      ],
      note: "مفاجأة تنتظر أوائل القادمين. نكشفها لك في اليوم السابق، هنا بالذات.",
      button: "أضِف الموعد إلى مفكرتي",
      secondary: "مشاهدة العد التنازلي",
      signature: ["إلى اللقاء قريبًا،", "فريق أعلان"],
    },
    places: {
      subject: (_w, p) => `${seats(p, "ar")} مكان في الإطلاق: سجّل من اليوم`,
      preheader: (_w, p) => `${need(p).credits} نقطة مجانية للأفراد، و${need(p).months} أشهر من «Essentiel» للمتاجر. مكان واحد لكل شخص.`,
      label: "J-1",
      title: () => "مكانك في الإطلاق ينتظرك",
      paragraphs: (w, p) => [`يفتح أعلان غدًا، ${w.when} (بتوقيت المغرب). أول ${seats(p, "ar")} من الأفراد وأول ${need(p).proSeats} من المتاجر يحصلون على هدية ترحيب.`],
      offers: (_w, p) => SHARED.ar.offers(need(p)),
      steps: (w, p) => [
        { when: "من الآن", text: "أنشئ حسابك." },
        ...(need(p).requirePhone ? [{ when: "من الآن", text: "وثّق رقم هاتفك." }] : []),
        { when: `غدًا، ${w.time}`, text: "انشر إعلانك الأول واحجز مكانك." },
      ],
      button: "إنشاء حسابي",
      closing: (w) => [w.lastDay ? `مكان واحد لكل شخص، يُمنح حتى ${w.lastDay} أو إلى أن تنفد الأماكن.` : "مكان واحد لكل شخص، يُمنح إلى أن تنفد الأماكن."],
      signature: ["نلتقي غدًا،", "فريق أعلان"],
    },
    opening: {
      subject: () => "فُتح الباب: انشر إعلانك الأول على أعلان",
      preheader: (_w, p) => (p ? `أماكن الإطلاق الـ${seats(p, "ar")} تذهب لأوائل القادمين.` : "أعلان متاح الآن. نشر الإعلان مجاني."),
      label: "اليوم",
      title: () => "الباب مفتوح",
      paragraphs: (_w, p) => [
        "أعلان متاح الآن. نشر الإعلان مجاني، ويراسلك المشترون عبر الرسائل: رقمك يبقى خاصًا.",
        "الإعلانات، كراء السيارات، كراء للعطل، متاجر المحترفين: كل شيء مفتوح.",
        ...(p ? [`أماكن الإطلاق الـ${seats(p, "ar")} مفتوحة: أول إعلان تقبله المراجعة يمنحك مكانك.`] : []),
      ],
      offers: (_w, p) => (p ? SHARED.ar.offers(p) : undefined),
      button: "نشر إعلاني الأول",
      early: true,
      closing: () => ["كانت هذه آخر رسالة من قائمة الافتتاح: سيُحذف عنوانك خلال 30 يومًا. شكرًا على انتظارك."],
      signature: ["مرحبًا بك في أعلان،", "فريق أعلان"],
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

/** "10:00", Morocco time, Latin digits. */
function time(iso: string, lang: MailLocale): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat(tagOf(lang), { hour: "2-digit", minute: "2-digit", timeZone: moroccoTimeZone(at.getTime()), numberingSystem: "latn" }).format(at);
}

/** Google Calendar "add event" link for the opening hour (no account data, nothing per recipient). */
export function calendarUrl(opensAt: string, siteUrl: string, lang: MailLocale): string {
  const start = new Date(opensAt);
  const stamp = (at: Date) =>
    at
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: lang === "ar" ? "افتتاح أعلان" : "Ouverture d'Aalan",
    dates: `${stamp(start)}/${stamp(new Date(start.getTime() + 3_600_000))}`,
    details: siteUrl,
    location: siteUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
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
    time: time(data.opensAt, ctx.lang),
    lastDay: lastDay(data.places?.until ?? null, ctx),
  };
  const site = ctx.siteUrl.replace(/\/$/, "");
  const home = `${site}/${ctx.locale}`;
  // J-1: sign-up opens with this e-mail (gate.ts "signup" phase, owner 16 Nov 2026). J-7: the
  // button saves the opening hour in the reader's calendar, the countdown is the link under it.
  const target = data.campaign === "opening" ? `${home}/deposer` : data.campaign === "places" ? `${home}/inscription` : calendarUrl(data.opensAt, home, ctx.lang);
  const offers = copy.offers?.(words, data.places);
  const built = renderDoorLayout({
    lang: ctx.lang,
    siteUrl: ctx.siteUrl,
    subject: copy.subject(words, data.places),
    preheader: copy.preheader(words, data.places),
    door: DOOR[data.campaign],
    kicker: words.when,
    label: copy.label,
    title: copy.title(words, data.places),
    paragraphs: copy.paragraphs(words, data.places),
    ...(copy.points ? { points: copy.points(words, data.places) } : {}),
    ...(offers ? { offers } : {}),
    ...(copy.steps ? { steps: copy.steps(words, data.places) } : {}),
    ...(copy.note ? { note: copy.note } : {}),
    action: { label: copy.button, url: target, ...(copy.early ? { early: true } : {}) },
    ...(copy.secondary ? { secondary: { label: copy.secondary, url: home } } : {}),
    ...(copy.closing ? { closing: copy.closing(words, data.places) } : {}),
    signature: copy.signature,
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
