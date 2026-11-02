// Incidents recorded by the uptime Worker (workers/uptime-probe): every probe alert and every
// alert the app relays. The agents' hourly check lists them and acknowledges each one it has
// handled; a P0 or P1 still unacknowledged 2 hours after it was recorded pages the owner on
// Telegram (dead man's switch). Reads and writes the Worker's KV namespace through the Cloudflare
// API with AALAN_CLOUDFLARE_API_TOKEN (former JOUTIYA_CLOUDFLARE_API_TOKEN; Workers KV Storage).
//
//   node scripts/incidents.ts list [--all] [--json]
//       open incidents (not acknowledged), newest first; --all includes acknowledged ones.
//   node scripts/incidents.ts show <id>
//   node scripts/incidents.ts ack <id>[,<id>...] --note="<what was done>" [--apply]
//       dry run by default. The note says what was checked or fixed (kept 14 days with the incident).
//
// In the cloud: NODE_USE_ENV_PROXY=1. Prints no token.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireEnvProxy } from "./env-proxy.ts";
import { requireOwnerVar } from "./owner-env.ts";
import { INCIDENT_PREFIX, INCIDENT_TTL_SECONDS, incidentMeta, type Incident, type IncidentMeta } from "../workers/uptime-probe/src/lib.ts";

const API = "https://api.cloudflare.com/client/v4";
const MAX_NOTE = 500;

/** The namespace bound as STATE in workers/uptime-probe/wrangler.jsonc. */
export function namespaceId(wrangler: string): string {
  const match = /"binding":\s*"STATE",\s*"id":\s*"([0-9a-f]{32})"/.exec(wrangler);
  if (!match?.[1]) throw new Error("workers/uptime-probe/wrangler.jsonc: no STATE namespace id");
  return match[1];
}

interface Listed {
  name: string;
  expiration?: number;
  metadata?: IncidentMeta;
}

class Kv {
  private readonly token: string;
  private readonly base: string;
  constructor(token: string, base: string) {
    this.token = token;
    this.base = base;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...init.headers } });
    if (!response.ok && response.status !== 404) {
      let detail = "";
      try {
        const body = (await response.json()) as { errors?: { code: number; message: string }[] };
        detail = (body.errors ?? []).map((error) => `${error.code} ${error.message}`).join("; ");
      } catch {
        // not JSON
      }
      throw new Error(`Cloudflare KV ${init.method ?? "GET"} ${path.split("?")[0]}: HTTP ${response.status} ${detail}`);
    }
    return response;
  }

  async list(): Promise<Listed[]> {
    const keys: Listed[] = [];
    let cursor = "";
    do {
      const params = new URLSearchParams({ prefix: INCIDENT_PREFIX, limit: "1000", ...(cursor ? { cursor } : {}) });
      const body = (await (await this.request(`/keys?${params}`)).json()) as { result: Listed[]; result_info?: { cursor?: string } };
      keys.push(...body.result);
      cursor = body.result_info?.cursor ?? "";
    } while (cursor);
    return keys;
  }

  async get(name: string): Promise<Incident | null> {
    const response = await this.request(`/values/${encodeURIComponent(name)}`);
    if (response.status === 404) return null;
    return JSON.parse(await response.text()) as Incident;
  }

  /** Bulk write (JSON): value, absolute expiration and listing metadata in one request. */
  async put(name: string, incident: Incident, expiration: number): Promise<void> {
    const body = [{ key: name, value: JSON.stringify(incident), expiration, metadata: incidentMeta(incident) }];
    await this.request("/bulk", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
}

function when(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatLine(key: Listed): string {
  const meta = key.metadata;
  const id = key.name.slice(INCIDENT_PREFIX.length);
  if (!meta) return `${id}  (no metadata)`;
  const state = meta.a ? "acked" : meta.x ? "OPEN, owner paged" : "OPEN";
  return `${id}  ${meta.s.padEnd(4)} ${when(meta.at)}  ${state.padEnd(17)} ${meta.t}`;
}

async function main(): Promise<void> {
  requireEnvProxy();
  const args = process.argv.slice(2);
  const [action, ids] = args.filter((arg) => !arg.startsWith("--"));
  if (!action || !["list", "show", "ack"].includes(action) || ((action === "show" || action === "ack") && !ids)) {
    throw new Error('usage: scripts/incidents.ts list [--all] [--json] | show <id> | ack <id>[,<id>...] --note="..." [--apply]');
  }
  const targets = JSON.parse(readFileSync(new URL("../infra/targets.json", import.meta.url), "utf8")) as { shared: { cloudflare: { accountId: string } } };
  const namespace = namespaceId(readFileSync(new URL("../workers/uptime-probe/wrangler.jsonc", import.meta.url), "utf8"));
  const kv = new Kv(requireOwnerVar("CLOUDFLARE_API_TOKEN"), `${API}/accounts/${targets.shared.cloudflare.accountId}/storage/kv/namespaces/${namespace}`);

  if (action === "list") {
    const keys = (await kv.list()).filter((key) => args.includes("--all") || !key.metadata?.a).sort((a, b) => b.name.localeCompare(a.name));
    if (args.includes("--json")) console.log(JSON.stringify(keys, null, 2));
    else if (keys.length === 0) console.log(args.includes("--all") ? "no incident in the last 14 days" : "no open incident");
    else for (const key of keys) console.log(formatLine(key));
    return;
  }

  const names = (ids as string).split(",").map((id) => `${INCIDENT_PREFIX}${id.trim()}`);
  if (action === "show") {
    const incident = await kv.get(names[0] as string);
    console.log(incident ? JSON.stringify(incident, null, 2) : "not found (expired after 14 days, or wrong id)");
    return;
  }

  const note = args.find((arg) => arg.startsWith("--note="))?.slice("--note=".length).trim() ?? "";
  if (!note) throw new Error('ack needs --note="<what was checked or done>"');
  const apply = args.includes("--apply");
  const expirations = new Map((await kv.list()).map((key) => [key.name, key.expiration]));
  for (const name of names) {
    const incident = await kv.get(name);
    if (!incident) {
      console.log(`${name.slice(INCIDENT_PREFIX.length)}: not found`);
      continue;
    }
    if (incident.ack) {
      console.log(`${incident.id}: already acknowledged ${when(incident.ack.at)} (${incident.ack.note})`);
      continue;
    }
    const expiration = expirations.get(name) ?? Math.floor(incident.at / 1000) + INCIDENT_TTL_SECONDS;
    console.log(`${apply ? "ack " : "plan"} ${incident.id}  ${incident.severity} ${incident.title}`);
    if (apply) await kv.put(name, { ...incident, ack: { at: Date.now(), note: note.slice(0, MAX_NOTE) } }, expiration);
  }
  if (!apply) console.log("\nDry run: nothing written. Add --apply to acknowledge.");
}

const self = fileURLToPath(import.meta.url);
if (/[\\/]incidents\.ts$/.test(self) && process.argv[1] !== undefined && realpathSync(process.argv[1]) === self) {
  main().catch((error: unknown) => {
    console.error(`incidents: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
