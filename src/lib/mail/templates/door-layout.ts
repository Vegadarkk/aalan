import { currentMailPublisher, escapeHtml, ltrHtml, ltrText, type BuiltMail, type MailLocale, type MailPublisher } from "./layout";

// Layout of the opening list's e-mails (owner, 2026-11-12; design "E-mails newsletter Aalan"):
// the night-green band with the logo, a gold rule, a hero where the logo's door opens a little more
// with each e-mail (closed, ajar, open), then the card. Table-based HTML with inline styles. The
// images are static files of the site (public/mail): no per-recipient URL, no tracking pixel, and
// every image has its alt text, so the e-mail reads the same with images blocked.

export type DoorState = "closed" | "ajar" | "open";

export interface DoorLayoutInput {
  lang: MailLocale;
  siteUrl: string;
  subject: string;
  /** Inbox preview line, hidden in the body. */
  preheader: string;
  door: DoorState;
  /** Small capitals over the hero's label ("Samedi 12 décembre · 10 h"); none for a small hero. */
  kicker?: string;
  /** Big hero label ("J-7", "Ouvert"); none: the door alone, small, over the title. */
  label?: string;
  title: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Shows the action's raw URL under the button (links that must survive a blocked button). */
  rawLink?: boolean;
  /** Smaller, muted paragraphs after the button. */
  closing?: string[];
  /** Why the recipient gets this e-mail (footer). */
  reason: string;
  /** One-click unsubscribe page link (campaign e-mails); none on the confirmation. */
  unsubscribe?: { label: string; url: string };
  publisher?: MailPublisher;
}

const COLORS = {
  page: "#f7f1e6",
  card: "#ffffff",
  border: "#e6d8bd",
  band: "#0d4b4d",
  rule: "#d2a24c",
  hero: { closed: "#f2e9d8", ajar: "#0b3a3c", open: "#f7ecd3" },
  kicker: { closed: "#7a5822", ajar: "#e2b865", open: "#7a5822" },
  label: { closed: "#0d4b4d", ajar: "#f2e9d8", open: "#a94b26" },
  text: "#0b1e1f",
  muted: "#4a5a5b",
  heading: "#0d4b4d",
  primary: "#a94b26",
  link: "#135a5b",
  footer: "#f2e9d8",
} as const;

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, Tahoma, sans-serif";

const ALT: Record<MailLocale, { logo: string; door: Record<DoorState, string> }> = {
  fr: { logo: "Aalan", door: { closed: "La porte d'Aalan, fermée", ajar: "La porte d'Aalan, entrouverte", open: "La porte d'Aalan, grande ouverte" } },
  ar: { logo: "أعلان", door: { closed: "باب أعلان، مغلق", ajar: "باب أعلان، مفتوح قليلًا", open: "باب أعلان، مفتوح على مصراعيه" } },
};

const PUBLISHED_BY: Record<MailLocale, string> = { fr: "Édité par ", ar: "الناشر: " };

const asset = (siteUrl: string, name: string) => `${siteUrl.replace(/\/$/, "")}/mail/${name}`;

function para(text: string, color: string = COLORS.text, size = 16): string {
  return `<p style="margin:0 0 16px;font-size:${size}px;line-height:1.6;color:${color};">${escapeHtml(text)}</p>`;
}

function hero(input: DoorLayoutInput, align: string, rtl: boolean): string {
  const doorImg = (width: number) =>
    `<img src="${escapeHtml(asset(input.siteUrl, `door-${input.door}.png`))}" width="${width}" height="${Math.round((width * 442) / 280)}" alt="${escapeHtml(ALT[input.lang].door[input.door])}" style="display:block;border:0;outline:none;width:${width}px;height:auto;">`;
  if (!input.label) return `<tr><td align="center" style="padding:40px 32px 8px;background:${COLORS.card};">${doorImg(64)}</td></tr>`;
  const words =
    `<td valign="bottom" style="padding:0 0 32px;text-align:${align};">` +
    (input.kicker ? `<div style="font-size:12px;font-weight:700;letter-spacing:${rtl ? "0" : "1.4px"};text-transform:uppercase;color:${COLORS.kicker[input.door]};">${escapeHtml(input.kicker)}</div>` : "") +
    `<div style="margin-top:6px;font-size:${input.label.length > 4 ? 56 : 80}px;line-height:1.05;font-weight:700;color:${COLORS.label[input.door]};">${escapeHtml(input.label)}</div>` +
    `</td>`;
  const door = `<td valign="bottom" width="140" style="width:140px;">${doorImg(140)}</td>`;
  return (
    `<tr><td style="padding:36px 40px 0;background:${COLORS.hero[input.door]};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${words}<td width="16" style="width:16px;"></td>${door}</tr></table>` +
    `</td></tr>`
  );
}

export function renderDoorLayout(input: DoorLayoutInput): BuiltMail {
  const rtl = input.lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const who = input.publisher ?? currentMailPublisher();
  const identity = `${who.name}, ${who.address}`;
  const body: string[] = [];

  body.push(`<h1 style="margin:0 0 16px;font-size:26px;line-height:1.3;font-weight:700;color:${COLORS.heading};">${escapeHtml(input.title)}</h1>`);
  for (const text of input.paragraphs) body.push(para(text));
  if (input.action) {
    const url = escapeHtml(input.action.url);
    body.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;"><tr><td style="border-radius:10px;background:${COLORS.primary};">` +
        `<a href="${url}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(input.action.label)}</a>` +
        `</td></tr></table>`,
    );
    if (input.rawLink) {
      body.push(`<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${COLORS.muted};word-break:break-all;"><a href="${url}" style="color:${COLORS.link};text-decoration:underline;">${url}</a></p>`);
    }
  }
  for (const text of input.closing ?? []) body.push(para(text, COLORS.muted, 14));

  const footer = [
    `<p style="margin:0 0 8px;">${escapeHtml(input.reason)}</p>`,
    input.unsubscribe ? `<p style="margin:0 0 8px;"><a href="${escapeHtml(input.unsubscribe.url)}" style="color:${COLORS.link};text-decoration:underline;">${escapeHtml(input.unsubscribe.label)}</a></p>` : "",
    `<p style="margin:0;">${escapeHtml(ALT[input.lang].logo)} · ${escapeHtml(PUBLISHED_BY[input.lang])}${ltrHtml(identity, rtl)}</p>`,
  ].join("");

  const html =
    `<!DOCTYPE html>` +
    `<html lang="${input.lang}" dir="${dir}">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">` +
    `<title>${escapeHtml(input.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${COLORS.page};font-family:${FONT};" dir="${dir}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};"><tr><td align="center" style="padding:32px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;" dir="${dir}">` +
    `<tr><td align="center" style="padding:24px 32px;background:${COLORS.band};">` +
    `<img src="${escapeHtml(asset(input.siteUrl, "aalan-logo-dark.png"))}" width="150" height="69" alt="${escapeHtml(ALT[input.lang].logo)}" style="display:block;border:0;outline:none;width:150px;height:auto;color:#f2e9d8;font-size:24px;font-weight:700;">` +
    `</td></tr>` +
    `<tr><td style="height:4px;line-height:4px;font-size:0;background:${COLORS.rule};">&nbsp;</td></tr>` +
    hero(input, align, rtl) +
    `<tr><td style="padding:${input.label ? 40 : 16}px 40px 32px;text-align:${align};">${body.join("")}</td></tr>` +
    `<tr><td style="padding:24px 32px;background:${COLORS.footer};text-align:center;font-size:12px;line-height:1.6;color:${COLORS.muted};">${footer}</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const lines: string[] = [input.title, "", ...input.paragraphs.flatMap((text) => [text, ""])];
  if (input.action) lines.push(`${input.action.label}${rtl ? ": " : " : "}${input.action.url}`, "");
  for (const text of input.closing ?? []) lines.push(text, "");
  lines.push("—", input.reason);
  if (input.unsubscribe) lines.push(`${input.unsubscribe.label}${rtl ? ": " : " : "}${input.unsubscribe.url}`);
  lines.push(`${ALT[input.lang].logo} · ${PUBLISHED_BY[input.lang]}${ltrText(identity, rtl)}`);
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { subject: input.subject, html, text };
}
