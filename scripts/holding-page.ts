// Holding page of aalan.ma before the production (owner, 6 Nov 2026; docs/lancement/page-attente.md):
// uploads the Worker `aalan-attente` (workers/holding-page) to the account of infra/targets.json and
// routes aalan.ma/* to it, in front of the production tunnel that has no server yet. Dry run unless
// --apply; --remove deletes the route and the Worker once the production serves aalan.ma.
//
//   NODE_USE_ENV_PROXY=1 node scripts/holding-page.ts [--apply] [--remove]
//
// Environment (never printed): AALAN_CLOUDFLARE_API_TOKEN (former JOUTIYA_CLOUDFLARE_API_TOKEN).
// Touches nothing but the Worker named WORKER and the route PATTERN of the aalan.ma zone.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnvProxy } from "./env-proxy.ts";
import { requireOwnerVar } from "./owner-env.ts";

const API = "https://api.cloudflare.com/client/v4";
export const WORKER = "aalan-attente";
export const PATTERN = "aalan.ma/*";
const ROOT = fileURLToPath(new URL("../workers/holding-page/", import.meta.url));
const COMPATIBILITY_DATE = "2026-09-29";

/** Module type of a file the Worker imports (Workers "text" and "data" modules). */
export function moduleType(file: string): string {
  if (file.endsWith(".js")) return "application/javascript+module";
  if (/\.(html|css)$/.test(file)) return "text/plain";
  return "application/octet-stream";
}

/** Every file of the Worker: its two scripts and the generated site. */
export function workerFiles(root = ROOT): string[] {
  const site = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? site(join(dir, entry.name)) : [join(dir, entry.name)]));
  return ["index.js", "manifest.js", ...site("site")];
}

interface Envelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
}

async function cf<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = (await response.json()) as Envelope<T>;
  if (!response.ok || !body.success) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body.errors ?? [])}`);
  return body.result;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const remove = process.argv.includes("--remove");
  requireEnvProxy();
  const token = requireOwnerVar("CLOUDFLARE_API_TOKEN");
  const targets = JSON.parse(readFileSync(new URL("../infra/targets.json", import.meta.url), "utf8")) as { shared: { cloudflare: { accountId: string; aalanZoneId: string } } };
  const { accountId, aalanZoneId } = targets.shared.cloudflare;
  const zone = await cf<{ name: string; account: { id: string } }>(token, `/zones/${aalanZoneId}`);
  if (zone.name !== "aalan.ma" || zone.account.id !== accountId) throw new Error("infra/targets.json aalanZoneId is not aalan.ma in the recorded account");

  const routes = await cf<{ id: string; pattern: string; script?: string }[]>(token, `/zones/${aalanZoneId}/workers/routes`);
  const route = routes.find((entry) => entry.pattern === PATTERN);
  if (route && route.script !== WORKER) throw new Error(`${PATTERN} already routes to ${route.script ?? "no Worker"}: left alone`);

  if (remove) {
    console.log(`${apply ? "" : "[dry run] "}delete route ${PATTERN}${route ? "" : " (absent)"} and Worker ${WORKER}`);
    if (!apply) return;
    if (route) await cf(token, `/zones/${aalanZoneId}/workers/routes/${route.id}`, { method: "DELETE" });
    await cf(token, `/accounts/${accountId}/workers/scripts/${WORKER}`, { method: "DELETE" });
    console.log("removed: aalan.ma goes back to the production tunnel");
    return;
  }

  const files = workerFiles();
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ main_module: "index.js", compatibility_date: COMPATIBILITY_DATE })], { type: "application/json" }));
  let bytes = 0;
  for (const file of files) {
    const content = readFileSync(join(ROOT, file));
    bytes += content.length;
    form.append(file, new Blob([content], { type: moduleType(file) }), file);
  }
  console.log(`${apply ? "" : "[dry run] "}upload Worker ${WORKER}: ${files.length} modules, ${Math.round(bytes / 1024)} KiB; route ${PATTERN} ${route ? "kept" : "created"}`);
  if (!apply) return;
  await cf(token, `/accounts/${accountId}/workers/scripts/${WORKER}`, { method: "PUT", body: form });
  // Served on aalan.ma only, never on a workers.dev address.
  await cf(token, `/accounts/${accountId}/workers/scripts/${WORKER}/subdomain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false, previews_enabled: false }),
  });
  if (!route) {
    await cf(token, `/zones/${aalanZoneId}/workers/routes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pattern: PATTERN, script: WORKER }) });
  }
  console.log(`deployed: https://aalan.ma serves ${WORKER}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
