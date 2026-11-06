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
    // The glints are played by the page's script, absent here.
    .replace(/<div class="welcome-glints"[^>]*><div class="welcome-glint-band"[^>]*>[\s\S]*?<\/svg><\/div><\/div>/, "")
    .replace(/<!--\/?\$?-->|<!-- -->/g, "");
  const timer = body.indexOf('<div role="timer"');
  const follow = body.indexOf("<section", timer);
  if (timer < 0 || follow < 0) throw new Error(`${locale}: timer not found`);
  body = body.slice(0, timer) + `<p class="hold-soon welcome-enter" data-enter="count">${t.soon}</p><p class="hold-sub">${t.sub}</p>` + body.slice(follow);
  // The legal links lead to pages the production serves: a language switch and the publisher notice instead.
  const nav = /<nav [^>]*class="launch-legal[^"]*"[^>]*>[\s\S]*?<\/nav>/.exec(body);
  if (!nav) throw new Error(`${locale}: legal links not found`);
  const notice =
    `<nav aria-label="${t.other.label}" class="launch-legal hold-notice welcome-enter" data-enter="legal"><ul><li><a href="${t.other.href}" lang="${t.other.lang}" hreflang="${t.other.lang}">${t.other.label}</a></li></ul>` +
    t.notice.map((line) => `<p>${line}</p>`).join("") +
    `</nav>`;
  body = body.replace(nav[0], notice);
  const html = `<!doctype html>${htmlTag}${head(locale, locale === "fr" ? "/" : "/ar")}<body class="antialiased">${body}</body></html>\n`;
  writeFileSync(join(site, `${locale}.html`), html);
}
writeFileSync(join(site, "launch.css"), css);

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

// Workers modules are imported statically: the manifest names every binary file the Worker serves.
const id = (name) => "m_" + name.replace(/[^\w]/g, "_");
const fontFiles = [...fonts].filter((file) => existsSync(join(site, "fonts", file))).sort();
const manifest = [
  "// Generated by build.mjs: the binary files of site/ the Worker serves.",
  ...fontFiles.map((file) => `import ${id(file)} from "./site/fonts/${file}";`),
  ...binaries.map(([, , to]) => `import ${id(to)} from "./site/${to}";`),
  "",
  `export const FONTS = {\n${fontFiles.map((file) => `  "${file}": ${id(file)},`).join("\n")}\n};`,
  `export const BINARIES = {\n${binaries.map(([path, , to, type]) => `  "${path}": { body: ${id(to)}, type: "${type}" },`).join("\n")}\n};`,
  "",
].join("\n");
writeFileSync(join(root, "manifest.js"), manifest);
console.log(`site written: ${site} (${fontFiles.length} fonts)`);
