// Launch gate (D21, docs/lancement/mise-en-production.md): read-only checks of the production site
// and of the launch records, run after `oracle-vm.ts promote --tag=vX.Y.Z` and before the site
// opens to visitors. Public URLs only (no key, no sign-in), plus files of this repository.
//
//   NODE_USE_ENV_PROXY=1 node scripts/launch-check.ts [--tag=vX.Y.Z] [--site=https://joutiya.ma] [--ads=off|test|live] [--rif=noindex|indexable] [--opening=YYYY-MM-DD]
//
// Automatic checks (exit code 1 when one fails):
//   - /api/health answers 200 "ok" with the tag's release: production started, so its startup gate
//     passed (legal mentions complete, targets, environment; src/lib/startup/checks.ts);
//   - /api/config: production, the expected ads mode (off until AdSense opens, D23), Turnstile,
//     Google sign-in and Firebase configured;
//   - the home page enforces its CSP (not report-only) and HSTS;
//   - search engines (D15, D16, D9): robots.txt open with the sitemap of the site, ads.txt as the ads
//     mode wants it, /fr indexable with its canonical on the site and the fr/ar hreflang cluster
//     (never rif), /rif noindex until its native review (--rif=indexable once RIF_INDEXABLE=true);
//   - MDN HTTP Observatory grade A or A+ (one public scan, at most one a minute per host);
//   - the restore drill B, the load test and the security audit are recorded;
//   - the legal reset (spec §10): every page at version 1.0 in force on the opening day (today by
//     default; Morocco is on UTC), the texts frozen and their hashes recorded (scripts/legal-hash.ts).
// Then the items no public URL shows are listed, to confirm by hand.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LAUNCH_LEGAL_VERSION, LEGAL_TEXTS_FROZEN, LEGAL_VERSIONS, PROVISIONAL_LEGAL_PAGES } from "../src/config/legal-versions.ts";
import { requireEnvProxy } from "./env-proxy.ts";
import { legalTextHashes, readHashRecord, staleHashes, type HashRecord, type TextHashes } from "./legal-hash.ts";

const USAGE = "usage: scripts/launch-check.ts [--tag=vX.Y.Z] [--site=https://joutiya.ma] [--ads=off|test|live] [--rif=noindex|indexable] [--opening=YYYY-MM-DD]";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/;
const ADS_MODES = ["off", "test", "live"] as const;
const RIF_MODES = ["noindex", "indexable"] as const;
const OBSERVATORY = "https://observatory-api.mdn.mozilla.net/api/v2/scan";
const root = fileURLToPath(new URL("..", import.meta.url));

export type AdsMode = (typeof ADS_MODES)[number];
export type RifMode = (typeof RIF_MODES)[number];

export interface LaunchArgs {
  tag: string | null;
  site: string;
  ads: AdsMode;
  /** Tarifit pages: noindex until the native review, then indexable (RIF_INDEXABLE=true). */
  rif: RifMode;
  /** Opening day (ISO): the date every legal page comes into force. */
  opening: string;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** What only a person can confirm: no public URL or repository file shows it. */
export const MANUAL_ITEMS = [
  "Google Auth Platform: the production OAuth app is published (In production), not in Testing",
  "Back office: salesEnabled=false, the Pro launch offer active, no 'Sauvegarde Firestore trop ancienne' alert in the last days",
  "Private anti-abuse values written in prod Firestore config/abuse (node scripts/abuse-config.ts prod <file outside the repo> --apply, or the back office), never in the repository: their committed values are public",
  "Tarifit catalogue reviewed by a native speaker; only then RIF_INDEXABLE=true in the prod app.env (and --rif=indexable here)",
  "Google Search Console: the site's property verified, /sitemap.xml submitted and read without error (the WAF serves sitemaps to verified bots only, so this check cannot fetch them)",
  "Canonical domain: CANONICAL_ORIGIN (src/config/site.ts) is the domain the site opens on; the Search engines checks fail otherwise",
  "Example listings: in prod only if the owner said go (worker: node dist/worker/seed-demo.mjs --production --apply), each one labelled 'Annonce exemple' and not contactable",
  "Prod Firestore rules and indexes deployed (scripts/deploy-prod.ts firestore)",
  "Repository back to private on the day the site opens to visitors (spec §10)",
  "Load-test bypass removed (docs/lancement/charge-procedure.md): `cloudflare.ts loadtest --off` applied and `cloudflare.ts zone --check` clean, LOADTEST_BYPASS_SECRET gone from the staging app.env, GitHub secret LOADTEST_BYPASS_SECRET deleted and variable LOAD_TEST_ENABLED unset",
] as const;

export function parseLaunchCli(argv: readonly string[], now = new Date()): LaunchArgs {
  let tag: string | null = null;
  let opening = now.toISOString().slice(0, 10);
  let site = "https://joutiya.ma";
  let ads: AdsMode = "off";
  let rif: RifMode = "noindex";
  for (const arg of argv) {
    const [name, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (name === "--tag" && RELEASE_TAG.test(value)) tag = value;
    else if (name === "--site" && /^https:\/\/[a-z0-9.-]+$/.test(value)) site = value;
    else if (name === "--ads" && (ADS_MODES as readonly string[]).includes(value)) ads = value as AdsMode;
    else if (name === "--rif" && (RIF_MODES as readonly string[]).includes(value)) rif = value as RifMode;
    else if (name === "--opening" && ISO_DAY.test(value) && !Number.isNaN(Date.parse(value))) opening = value;
    else throw new Error(`${arg}: not understood\n${USAGE}`);
  }
  return { tag, site, ads, rif, opening };
}

/** /api/health: 200 "ok" and the release expected (`release`: 12 hex of the tag's commit, or null for any built release). */
export function checkHealth(status: number, body: unknown, release: string | null): Check {
  const report = (body ?? {}) as { status?: unknown; release?: unknown; checks?: Record<string, unknown> };
  const running = typeof report.release === "string" ? report.release : "";
  const failing = Object.entries(report.checks ?? {})
    .filter(([, state]) => state === "fail")
    .map(([name]) => name);
  if (status !== 200 || report.status !== "ok") return { name: "Production health", ok: false, detail: `HTTP ${status}, status ${String(report.status)}${failing.length > 0 ? `, failing: ${failing.join(", ")}` : ""}` };
  if (release !== null && running !== release) return { name: "Production health", ok: false, detail: `runs ${running || "no release"}, the tag is ${release}: promote it first` };
  if (release === null && !/^[0-9a-f]{12}$/.test(running)) return { name: "Production health", ok: false, detail: `runs "${running}", not a CI release` };
  return { name: "Production health", ok: true, detail: `ok, release ${running}` };
}

/** /api/config: production values, as decided for the launch. */
export function checkConfig(status: number, body: unknown, site: string, ads: AdsMode): Check {
  if (status !== 200) return { name: "Production config", ok: false, detail: `HTTP ${status}` };
  const config = (body ?? {}) as { env?: unknown; siteUrl?: unknown; ads?: { mode?: unknown }; turnstileSiteKey?: unknown; googleClientId?: unknown; firebase?: unknown };
  const problems = [
    config.env === "prod" ? null : `env ${String(config.env)}`,
    config.siteUrl === site ? null : `siteUrl ${String(config.siteUrl)}`,
    config.ads?.mode === ads ? null : `ads ${String(config.ads?.mode)} (expected ${ads})`,
    config.turnstileSiteKey ? null : "no Turnstile site key",
    config.googleClientId ? null : "no Google sign-in client",
    config.firebase ? null : "no Firebase config",
  ].filter((problem) => problem !== null);
  return { name: "Production config", ok: problems.length === 0, detail: problems.length === 0 ? `prod, ads ${ads}` : problems.join("; ") };
}

/** Home page headers: an enforced CSP and HSTS. */
export function checkHeaders(status: number, headers: Headers): Check {
  const csp = headers.get("content-security-policy") ?? "";
  const problems = [
    status === 200 ? null : `HTTP ${status}`,
    /default-src|script-src/.test(csp) ? null : headers.has("content-security-policy-report-only") ? "CSP in report-only" : "no CSP",
    headers.has("strict-transport-security") ? null : "no HSTS",
  ].filter((problem) => problem !== null);
  return { name: "Security headers", ok: problems.length === 0, detail: problems.length === 0 ? "CSP enforced, HSTS" : problems.join("; ") };
}

/** Google's certification authority id in ads.txt (src/app/ads.txt/route.ts). */
const ADS_TXT_LINE = /^google\.com, pub-\d{16}, DIRECT, f08c47fec0942fa0$/m;

/** robots.txt of production: crawling allowed, the API closed, the sitemap on this site. */
export function checkRobotsTxt(status: number, body: string, site: string): Check {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const problems = [
    status === 200 ? null : `HTTP ${status}`,
    lines.some((line) => /^disallow:\s*\/$/i.test(line)) ? "Disallow: / (crawling closed: APP_ENV is not prod?)" : null,
    lines.some((line) => /^disallow:\s*\/api\/$/i.test(line)) ? null : "no Disallow: /api/",
    lines.some((line) => line.toLowerCase() === `sitemap: ${site}/sitemap.xml`) ? null : `no Sitemap: ${site}/sitemap.xml`,
  ].filter((problem) => problem !== null);
  return { name: "robots.txt", ok: problems.length === 0, detail: problems.length === 0 ? `open, sitemap ${site}/sitemap.xml` : problems.join("; ") };
}

/** ads.txt: 404 while AdSense is off (nothing to declare), Google's line once a publisher id is set. */
export function checkAdsTxt(status: number, body: string, ads: AdsMode): Check {
  if (ads === "off") return { name: "ads.txt", ok: status === 404, detail: status === 404 ? "404 (ads off)" : `HTTP ${status} while ads are off` };
  const ok = status === 200 && ADS_TXT_LINE.test(body);
  return { name: "ads.txt", ok, detail: ok ? "Google publisher line" : `HTTP ${status}, no "google.com, pub-…, DIRECT, f08c47fec0942fa0" line` };
}

/** `<link>` tags of a page head: rel, href and hreflang, attribute order and case free. */
export function headLinks(html: string): { rel: string; href: string; hreflang: string | null }[] {
  const head = html.split(/<\/head>/i)[0] ?? "";
  return [...head.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => {
    const attribute = (name: string) => new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(tag)?.[1] ?? null;
    return { rel: (attribute("rel") ?? "").toLowerCase(), href: attribute("href") ?? "", hreflang: attribute("hreflang") };
  });
}

function robotsMeta(html: string): string {
  const head = html.split(/<\/head>/i)[0] ?? "";
  return /<meta\b[^>]*name=["']robots["'][^>]*>/i.exec(head)?.[0] ?? "";
}

/** /fr: indexable, canonical on the site, hreflang fr-MA + ar-MA + x-default on the site, no Tarifit. */
export function checkIndexing(status: number, headers: Headers, html: string, site: string): Check {
  const links = headLinks(html);
  const canonical = links.find((link) => link.rel === "canonical")?.href ?? null;
  const cluster = new Map(links.filter((link) => link.rel === "alternate" && link.hreflang).map((link) => [link.hreflang!.toLowerCase(), link.href]));
  const problems = [
    status === 200 ? null : `HTTP ${status}`,
    /noindex/i.test(headers.get("x-robots-tag") ?? "") ? `X-Robots-Tag ${headers.get("x-robots-tag")}` : null,
    /noindex/i.test(robotsMeta(html)) ? "meta robots noindex" : null,
    canonical === `${site}/fr` ? null : `canonical ${canonical ?? "missing"} (expected ${site}/fr: CANONICAL_ORIGIN)`,
    cluster.get("fr-ma") === `${site}/fr` && cluster.get("ar-ma") === `${site}/ar` && cluster.get("x-default") === `${site}/fr` ? null : `hreflang cluster ${JSON.stringify(Object.fromEntries(cluster))}`,
    [...cluster.keys()].some((tag) => tag.startsWith("rif")) ? "Tarifit in the hreflang cluster" : null,
  ].filter((problem) => problem !== null);
  return { name: "Indexing of /fr", ok: problems.length === 0, detail: problems.length === 0 ? `indexable, canonical and hreflang on ${site}` : problems.join("; ") };
}

/** /rif: noindex (follow) until its native review, then indexable. */
export function checkRifIndexing(status: number, headers: Headers, rif: RifMode): Check {
  const tag = headers.get("x-robots-tag") ?? "";
  const noindex = /noindex/i.test(tag);
  const problems = [status === 200 ? null : `HTTP ${status}`, rif === "noindex" ? (noindex ? null : "indexable before its native review (RIF_INDEXABLE set?)") : noindex ? `X-Robots-Tag ${tag} (RIF_INDEXABLE not true?)` : null].filter((problem) => problem !== null);
  return { name: "Indexing of /rif", ok: problems.length === 0, detail: problems.length === 0 ? (rif === "noindex" ? `X-Robots-Tag ${tag}` : "indexable") : problems.join("; ") };
}

/** One HTTP Observatory v2 answer: grade A or A+. */
export function checkObservatory(body: unknown): Check {
  const scan = (body ?? {}) as { grade?: unknown; score?: unknown; error?: unknown; details_url?: unknown };
  if (scan.error) return { name: "HTTP Observatory", ok: false, detail: `scan error: ${String(scan.error)}` };
  const grade = typeof scan.grade === "string" ? scan.grade : "?";
  return { name: "HTTP Observatory", ok: grade === "A" || grade === "A+", detail: `grade ${grade} (score ${String(scan.score)})${typeof scan.details_url === "string" ? `, ${scan.details_url}` : ""}` };
}

/** The drill B row of docs/backups.md, filled in (a date in its first cell). */
export function drillRecorded(markdown: string): boolean {
  return /^\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*B\s*\|/m.test(markdown);
}

/** Launch records of the repository: restore drill B, load test, security audit. */
export function checkRecords(read: (path: string) => string | null): Check[] {
  const backups = read("docs/backups.md");
  return [
    { name: "Restore drill B recorded", ok: backups !== null && drillRecorded(backups), detail: "docs/backups.md, row B of the drill table" },
    { name: "Load test recorded", ok: read("docs/lancement/charge.md") !== null, detail: "docs/lancement/charge.md (D17)" },
    { name: "Security audit recorded", ok: read("docs/lancement/audit-securite.md") !== null, detail: "docs/lancement/audit-securite.md (D18)" },
  ];
}

export interface LegalState {
  versions: Record<string, { version: string; effective: string }>;
  provisional: ReadonlySet<string>;
  frozen: boolean;
  recorded: HashRecord | null;
  actual: Record<string, TextHashes>;
}

/**
 * The legal reset of the opening day (spec §10, D11): every page but the provisional ones at
 * version 1.0 in force on `opening`, the texts frozen, their hashes recorded for these versions.
 */
export function checkLegal(state: LegalState, opening: string): Check {
  const problems: string[] = [];
  const pages = Object.entries(state.versions).filter(([slug]) => !state.provisional.has(slug));
  const notReset = pages.filter(([, entry]) => entry.version !== LAUNCH_LEGAL_VERSION).map(([slug, entry]) => `${slug} ${entry.version}`);
  const notDated = pages.filter(([, entry]) => entry.effective !== opening).map(([slug, entry]) => `${slug} ${entry.effective}`);
  if (notReset.length > 0) problems.push(`not at ${LAUNCH_LEGAL_VERSION}: ${notReset.join(", ")}`);
  if (notDated.length > 0) problems.push(`not in force on ${opening}: ${notDated.join(", ")}`);
  if (!state.frozen) problems.push("LEGAL_TEXTS_FROZEN is false");
  const stale = staleHashes(state.recorded, state.actual, state.versions);
  if (stale.length > 0) problems.push(`hashes not recorded (node scripts/legal-hash.ts --apply): ${stale.join(", ")}`);
  return { name: "Legal reset", ok: problems.length === 0, detail: problems.length === 0 ? `${pages.length} pages at ${LAUNCH_LEGAL_VERSION} from ${opening}, texts frozen` : problems.join("; ") };
}

/** The 12 hex of the tag's commit, from origin (null when the tag is not there). */
function tagRelease(tag: string): string | null {
  spawnSync("git", ["fetch", "--quiet", "--force", "origin", `refs/tags/${tag}:refs/tags/${tag}`], { cwd: root, stdio: "ignore" });
  const commit = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { cwd: root, encoding: "utf8" });
  return commit.status === 0 ? commit.stdout.trim().slice(0, 12) : null;
}

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...init?.headers }, signal: AbortSignal.timeout(60_000) });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An HTML error page: the status says enough.
  }
  return { status: response.status, body };
}

/** Runs a check; a network failure is a failed check, not a crash. */
async function attempt(name: string, check: () => Promise<Check>): Promise<Check> {
  try {
    return await check();
  } catch (error) {
    return { name, ok: false, detail: `request failed (${(error as Error).message})` };
  }
}

function readRepo(path: string): string | null {
  const file = `${root}/${path}`;
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

async function main(): Promise<void> {
  requireEnvProxy();
  const args = parseLaunchCli(process.argv.slice(2));
  const release = args.tag ? tagRelease(args.tag) : null;
  if (args.tag && release === null) throw new Error(`tag ${args.tag} is not on origin`);
  const host = new URL(args.site).hostname;
  console.log(`Launch check of ${args.site}${args.tag ? ` for ${args.tag} (${release})` : ""}\n`);

  const checks: Check[] = [
    await attempt("Production health", async () => {
      const { status, body } = await getJson(`${args.site}/api/health`, { cache: "no-store" });
      return checkHealth(status, body, release);
    }),
    await attempt("Production config", async () => {
      const { status, body } = await getJson(`${args.site}/api/config`);
      return checkConfig(status, body, args.site, args.ads);
    }),
    await attempt("Security headers", async () => {
      const response = await fetch(`${args.site}/fr`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      return checkHeaders(response.status, response.headers);
    }),
    await attempt("robots.txt", async () => {
      const response = await fetch(`${args.site}/robots.txt`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      return checkRobotsTxt(response.status, await response.text(), args.site);
    }),
    await attempt("ads.txt", async () => {
      const response = await fetch(`${args.site}/ads.txt`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      return checkAdsTxt(response.status, await response.text(), args.ads);
    }),
    await attempt("Indexing of /fr", async () => {
      const response = await fetch(`${args.site}/fr`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      return checkIndexing(response.status, response.headers, await response.text(), args.site);
    }),
    await attempt("Indexing of /rif", async () => {
      const response = await fetch(`${args.site}/rif`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      return checkRifIndexing(response.status, response.headers, args.rif);
    }),
    await attempt("HTTP Observatory", async () => checkObservatory((await getJson(`${OBSERVATORY}?host=${encodeURIComponent(host)}`, { method: "POST" })).body)),
    ...checkRecords(readRepo),
    checkLegal({ versions: LEGAL_VERSIONS, provisional: PROVISIONAL_LEGAL_PAGES, frozen: LEGAL_TEXTS_FROZEN, recorded: readHashRecord(readRepo), actual: legalTextHashes(readRepo) }, args.opening),
  ];
  for (const check of checks) console.log(`${check.ok ? "ok  " : "FAIL"}  ${check.name}: ${check.detail}`);
  console.log("\nTo confirm by hand:");
  for (const item of MANUAL_ITEMS) console.log(`  [ ] ${item}`);
  const failed = checks.filter((check) => !check.ok).length;
  console.log(failed === 0 ? "\nAutomatic checks passed." : `\n${failed} automatic check(s) failed: the site does not open.`);
  if (failed > 0) process.exitCode = 1;
}

const self = fileURLToPath(import.meta.url);
if (/[\\/]launch-check\.(?:ts|mjs)$/.test(self) && process.argv[1] !== undefined && realpathSync(process.argv[1]) === self) {
  main().catch((error: unknown) => {
    console.error(`launch-check: ${(error as Error).message}`);
    process.exit(1);
  });
}
