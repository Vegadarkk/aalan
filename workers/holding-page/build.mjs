// Builds the static files of the holding page (docs/lancement/page-attente.md) from the countdown page
// the app renders (src/app/[locale]/(closed)/ouverture): the same door, inscription and social links,
// "Bientôt" in place of the clock, and a short publisher notice in place of the legal links (the
// legal pages come with the production). Input: the HTML of /fr and /ar from a local `next dev`
// started with OPENS_AT and BRAND_SOCIAL_LINKS set; output: workers/holding-page/site/ and
// manifest.js (committed, uploaded by scripts/holding-page.ts).
//
//   curl -s localhost:3000/fr > cap/fr.html; curl -s localhost:3000/ar > cap/ar.html
//   node workers/holding-page/build.mjs cap http://localhost:3000

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [captureDir, origin] = process.argv.slice(2);
if (!captureDir || !origin) throw new Error("usage: build.mjs <capture dir> <dev server origin>");
const root = fileURLToPath(new URL(".", import.meta.url));
const site = join(root, "site");
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, "fonts"), { recursive: true });

const LOCALES = ["fr", "ar"];

const TEXT = {
  fr: {
    soon: "Bientôt",
    sub: "Les petites annonces du Maroc ouvrent bientôt leurs portes.",
    title: "Aalan : bientôt ouvert",
    description: "Aalan, les petites annonces du Maroc, ouvre bientôt ses portes. Suivez-nous pour ne rien manquer.",
    other: { href: "/ar", label: "العربية", lang: "ar" },
    ogLocale: "fr_MA",
    legal: [["mentions-legales", "Mentions légales"], ["cgu", "CGU"], ["confidentialite", "Confidentialité"], ["cookies", "Cookies"]],
    notice: [
      "Éditeur : Adark Prime, 6 rue d'Armaillé, 75017 Paris, France · Contact : <a href=\"mailto:reseaux@aalan.ma\">reseaux@aalan.ma</a>",
      "Hébergeur de cette page : Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis",
      "Cette page ne dépose aucun cookie et ne collecte aucune donnée.",
    ],
  },
  ar: {
    soon: "قريبًا",
    sub: "أعلان، موقع الإعلانات المبوبة في المغرب، يفتح أبوابه قريبًا.",
    title: "أعلان: قريبًا",
    description: "أعلان، موقع الإعلانات المبوبة في المغرب، يفتح أبوابه قريبًا. تابعونا حتى لا يفوتكم شيء.",
    other: { href: "/", label: "Français", lang: "fr" },
    ogLocale: "ar_MA",
    legal: [["mentions-legales", "الإشعارات القانونية"], ["cgu", "شروط الاستخدام"], ["confidentialite", "الخصوصية"], ["cookies", "ملفات الارتباط"]],
    notice: [
      "الناشر: <span dir=\"ltr\">Adark Prime, 6 rue d'Armaillé, 75017 Paris</span>، فرنسا · للتواصل: <a href=\"mailto:reseaux@aalan.ma\">reseaux@aalan.ma</a>",
      "مستضيف هذه الصفحة: <span dir=\"ltr\">Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107</span>، الولايات المتحدة",
      "هذه الصفحة لا تضع أي ملفات ارتباط ولا تجمع أي بيانات.",
    ],
  },
};

const fonts = new Set();

/** The stylesheets the page links, as served (CSSOM text loses var() in shorthands), fonts served by the Worker. */
async function pageCss(dom) {
  const hrefs = [...dom.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  if (hrefs.length === 0) throw new Error("no stylesheet linked");
  const parts = [];
  for (const href of hrefs) {
    const response = await fetch(new URL(href.replaceAll("&amp;", "&"), origin));
    if (!response.ok) throw new Error(`${href}: ${response.status}`);
    parts.push(await response.text());
  }
  return parts
    .join("\n")
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "")
    .replace(/url\("?(?:\.\.\/media\/|\/_next\/static\/media\/)([^")]+\.woff2)"?\)/g, (_, file) => {
      fonts.add(file);
      return `url("/hold/fonts/${file}")`;
    });
}

function head(locale, canonicalPath) {
  const t = TEXT[locale];
  return (
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0f2e2f"><meta name="color-scheme" content="dark">` +
    `<title>${t.title}</title><meta name="description" content="${t.description}">` +
    `<link rel="canonical" href="https://aalan.ma${canonicalPath}"><link rel="alternate" hreflang="fr" href="https://aalan.ma/"><link rel="alternate" hreflang="ar" href="https://aalan.ma/ar">` +
    `<meta property="og:title" content="${t.title}"><meta property="og:description" content="${t.description}"><meta property="og:site_name" content="Aalan"><meta property="og:type" content="website"><meta property="og:locale" content="${t.ogLocale}"><meta property="og:url" content="https://aalan.ma${canonicalPath}"><meta property="og:image" content="https://aalan.ma/hold/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">` +
    `<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" href="/hold/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/hold/apple-touch-icon.png">` +
    `<link rel="stylesheet" href="/hold/launch.css"></head>`
  );
}

const HOLD_CSS = `
.hold-soon{font-family:var(--font-readex),sans-serif;font-weight:300;line-height:1.05;font-size:clamp(2.75rem,1.6rem + 5vw,5rem);letter-spacing:.01em;color:var(--color-cream-100,var(--color-cream-200));text-shadow:0 0 .6em color-mix(in oklab,var(--color-gold-400) 30%,transparent);margin-top:.5rem}
:lang(ar) .hold-soon{letter-spacing:0}
.hold-sub{color:var(--color-cream-200);text-wrap:balance;font-size:clamp(1rem,.9rem + .4vw,1.1875rem);margin-top:.75rem;max-width:34ch}
.hold-notice{max-width:46rem;text-wrap:balance;line-height:1.6}
.hold-notice p+p{margin-top:.25rem}
`;

let css = "";
for (const locale of LOCALES) {
  const t = TEXT[locale];
  const dom = readFileSync(join(captureDir, `${locale}.html`), "utf8");
  css ||= (await pageCss(dom)) + HOLD_CSS;
  const htmlTag = dom.slice(dom.indexOf("<html"), dom.indexOf(">", dom.indexOf("<html")) + 1);
  const start = dom.indexOf('<div class="welcome launch"');
  const end = dom.indexOf("<script", start);
  if (start < 0 || end < 0) throw new Error(`${locale}: countdown markup not found`);
  let body = dom
    .slice(start, end)
    .replace('data-state="counting"', 'data-state="soon"')
    .replace(/<!--\/?\$?-->|<!-- -->/g, "");
  const timer = body.indexOf('<div role="timer"');
  const follow = body.indexOf("<section", timer);
  if (timer < 0 || follow < 0) throw new Error(`${locale}: timer not found`);
  body = body.slice(0, timer) + `<p class="hold-soon welcome-enter" data-enter="count">${t.soon}</p><p class="hold-sub">${t.sub}</p>` + body.slice(follow);
  // The legal links lead to pages the production serves: a language switch and the publisher notice instead.
  const nav = /<nav [^>]*class="launch-legal[^"]*"[^>]*>[\s\S]*?<\/nav>/.exec(body);
  if (!nav) throw new Error(`${locale}: legal links not found`);
  const notice =
    `<nav aria-label="${t.other.label}" class="launch-legal hold-notice welcome-enter" data-enter="legal"><ul><li><a href="${t.other.href}" lang="${t.other.lang}" hreflang="${t.other.lang}">${t.other.label}</a></li>` +
    t.legal.map(([slug, label]) => `<li><a href="/${locale}/legal/${slug}">${label}</a></li>`).join("") +
    `</ul>` +
    t.notice.map((line) => `<p>${line}</p>`).join("") +
    `</nav>`;
  body = body.replace(nav[0], notice);
  // The waves of light on the gate's tiles: glints.js, a copy of the page's glint layer.
  const html = `<!doctype html>${htmlTag}${head(locale, locale === "fr" ? "/" : "/ar")}<body class="antialiased">${body}<script src="/hold/glints.js" defer></script></body></html>\n`;
  writeFileSync(join(site, `${locale}.html`), html);
}
writeFileSync(join(site, "launch.css"), css);

// Legal texts (asked 6 Nov 2026 for the social networks' reviews: Meta, TikTok, YouTube need public
// privacy and terms URLs): the <main> of each legal page as the app renders it, in a plain frame
// (brand, pre-opening note naming this page's host, links to the other texts). Captured as
// <capture dir>/<locale>-<slug>.html; a slug without its capture is left out.
const LEGAL = [
  ["mentions-legales", "Mentions légales", "الإشعارات القانونية"],
  ["cgu", "CGU", "شروط الاستخدام"],
  ["cgv", "CGV", "شروط البيع"],
  ["confidentialite", "Confidentialité", "الخصوصية"],
  ["cookies", "Cookies", "ملفات الارتباط"],
  ["objets-interdits", "Objets interdits", "المواد الممنوعة"],
  ["referencement-et-classement", "Référencement et classement", "الإدراج والترتيب"],
  ["droits-et-obligations", "Droits et obligations", "الحقوق والالتزامات"],
  ["avis-utilisateurs", "Avis des utilisateurs", "آراء المستخدمين"],
  ["confiance-et-securite", "Confiance et sécurité", "الثقة والأمان"],
  ["paiement-en-plusieurs-fois", "Paiement en plusieurs fois", "الدفع بالتقسيط"],
  ["contact-autorites", "Contact autorités (DSA)", "التواصل مع السلطات"],
];
const LEGAL_TEXT = {
  fr: {
    back: "Retour à l'accueil",
    note: "Aalan ouvre bientôt ses portes. D'ici là, ce site est une page d'attente servie par Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis. Les textes ci-dessous s'appliqueront au service dès son ouverture.",
    others: "Informations légales",
  },
  ar: {
    back: "العودة إلى الصفحة الرئيسية",
    note: "أعلان يفتح أبوابه قريبًا. إلى ذلك الحين، هذا الموقع صفحة انتظار تستضيفها <span dir=\"ltr\">Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107</span>، الولايات المتحدة. تسري النصوص أدناه على الخدمة فور افتتاحها.",
    others: "معلومات قانونية",
  },
};
const LEGAL_CSS = `
.hold-legal{min-height:100dvh;display:flex;flex-direction:column;background:var(--color-background,#fff);color:var(--color-foreground,#111)}
.hold-legal-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1rem;background:#0f2e2f;color:#f2e9d8}
.hold-legal-bar a{color:inherit;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:.5rem}
.hold-legal-bar img{width:28px;height:28px}
.hold-legal-note{margin:0 auto;max-width:72rem;padding:.75rem 1rem;font-size:.875rem;line-height:1.5;opacity:.85}
.hold-legal-foot{border-top:1px solid color-mix(in oklab,currentColor 15%,transparent);padding:1.5rem 1rem 2rem;font-size:.875rem}
.hold-legal-foot ul{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;max-width:72rem;margin:.5rem auto 0;list-style:none;padding:0}
.hold-legal-foot h2{max-width:72rem;margin:0 auto;font-weight:600}
.hold-legal-foot a{text-decoration:underline;text-underline-offset:2px}
`;
const legalPages = [];
for (const locale of LOCALES) {
  const t = LEGAL_TEXT[locale];
  const available = LEGAL.filter(([slug]) => existsSync(join(captureDir, `${locale}-${slug}.html`)));
  const footer =
    `<footer class="hold-legal-foot"><h2>${t.others}</h2><ul>` +
    available.map(([slug, fr, ar]) => `<li><a href="/${locale}/legal/${slug}">${locale === "ar" ? ar : fr}</a></li>`).join("") +
    `<li><a href="${TEXT[locale].other.href === "/" ? "/fr" : "/ar"}/legal/mentions-legales" lang="${TEXT[locale].other.lang}">${TEXT[locale].other.label}</a></li></ul></footer>`;
  for (const [slug] of available) {
    const dom = readFileSync(join(captureDir, `${locale}-${slug}.html`), "utf8");
    const htmlTag = dom.slice(dom.indexOf("<html"), dom.indexOf(">", dom.indexOf("<html")) + 1);
    const start = dom.indexOf("<main");
    const end = dom.indexOf("</main>", start);
    if (start < 0 || end < 0) throw new Error(`${locale}/${slug}: <main> not found`);
    const main = dom.slice(start, end + "</main>".length).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--\/?\$?-->|<!-- -->/g, "");
    const title = (/<title>([^<]*)<\/title>/.exec(dom)?.[1] ?? "Aalan").trim();
    const description = /<meta name="description" content="([^"]*)"/.exec(dom)?.[1] ?? "";
    const path = `/${locale}/legal/${slug}`;
    const pageHead = head(locale, path)
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta name="description" content=")[^"]*/, `$1${description}`)
      .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${description}`)
      .replace(/<link rel="alternate"[^>]*>/g, "")
      .replace('<meta name="theme-color" content="#0f2e2f"><meta name="color-scheme" content="dark">', '<meta name="theme-color" content="#0f2e2f"><meta name="color-scheme" content="light">');
    const bar =
      `<div class="hold-legal-bar"><a href="${locale === "ar" ? "/ar" : "/"}"><img src="/hold/icon.svg" alt="" width="28" height="28">Aalan</a><a href="${locale === "ar" ? "/ar" : "/"}">${t.back}</a></div>` +
      `<p class="hold-legal-note">${t.note}</p>`;
    const html = `<!doctype html>${htmlTag}${pageHead}<body class="antialiased"><div class="hold-legal">${bar}${main}${footer}</div></body></html>\n`;
    const name = `${locale}-legal-${slug}`;
    writeFileSync(join(site, `${name}.html`), html);
    legalPages.push(name);
  }
}
writeFileSync(join(site, "launch.css"), css + LEGAL_CSS);

for (const file of fonts) {
  const response = await fetch(`${origin}/_next/static/media/${file}`);
  if (!response.ok) throw new Error(`font ${file}: ${response.status}`);
  writeFileSync(join(site, "fonts", file), Buffer.from(await response.arrayBuffer()));
}

const pub = join(root, "../../public");
const binaries = [
  ["/favicon.ico", "favicon.ico", "favicon.ico", "image/x-icon"],
  ["/hold/icon.svg", "brand/aalan-icon.svg", "icon.svg", "image/svg+xml"],
  ["/hold/apple-touch-icon.png", "brand/apple-touch-icon.png", "apple-touch-icon.png", "image/png"],
  ["/hold/og.png", "brand/og-default.png", "og.png", "image/png"],
];
for (const [, from, to] of binaries) copyFileSync(join(pub, from), join(site, to));
// The glint script is served as text: a .js module would run inside the Worker.
copyFileSync(join(root, "glints.js"), join(site, "glints.txt"));

// Workers modules are imported statically: the manifest names every binary file the Worker serves.
const id = (name) => "m_" + name.replace(/[^\w]/g, "_");
const fontFiles = [...fonts].filter((file) => existsSync(join(site, "fonts", file))).sort();
const manifest = [
  "// Generated by build.mjs: the legal pages and binary files of site/ the Worker serves.",
  ...legalPages.map((name) => `import ${id(name)} from "./site/${name}.html";`),
  ...fontFiles.map((file) => `import ${id(file)} from "./site/fonts/${file}";`),
  ...binaries.map(([, , to]) => `import ${id(to)} from "./site/${to}";`),
  "",
  `export const LEGAL_PAGES = {\n${legalPages.map((name) => `  "${name}": ${id(name)},`).join("\n")}\n};`,
  `export const FONTS = {\n${fontFiles.map((file) => `  "${file}": ${id(file)},`).join("\n")}\n};`,
  `export const BINARIES = {\n${binaries.map(([path, , to, type]) => `  "${path}": { body: ${id(to)}, type: "${type}" },`).join("\n")}\n};`,
  "",
].join("\n");
writeFileSync(join(root, "manifest.js"), manifest);
console.log(`site written: ${site} (${legalPages.length} legal pages, ${fontFiles.length} fonts)`);
