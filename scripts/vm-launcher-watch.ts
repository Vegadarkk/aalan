// Health check of the free VM launcher (workers/vm-launcher), read only, for the scheduled routine that
// watches it so a broken hunt never goes unnoticed (owner, 2 Nov 2026: failures reach Claude, not him).
//
//   node scripts/vm-launcher-watch.ts [--hours=<n>] [--tail-seconds=<n>]
//
// 1. Oracle (AALAN_OCI_*, user joutiya-claude): live instances of the compartment, and launches by
//    joutiya-launcher in the last <n> hours (default 2) that ended TERMINATED: a request Oracle took
//    and then dropped, so capacity was there and the launch itself was wrong.
// 2. Cloudflare (AALAN_CLOUDFLARE_API_TOKEN): the Worker and its cron exist, then its log lines for
//    <n> seconds (default 150) through a temporary tail, deleted afterwards.
// Prints one verdict line: `verdict ok`, `verdict done` (both spares live: the Worker can go) or
// `verdict anomaly: ...`; exit code 0, 0, 2. Never prints a secret.
import { readFileSync } from "node:fs";
import { requireEnvProxy } from "./env-proxy.ts";
import { signedHeaders, type OciCredentials } from "./oracle-vm.ts";
import { requireOwnerVar } from "./owner-env.ts";

export const WORKER = "joutiya-vm-launcher";
const A1 = "VM.Standard.A1.Flex";
const MICRO = "VM.Standard.E2.1.Micro";
const SPARES = 2;

interface Instance {
  id: string;
  displayName?: string | null;
  shape: string;
  lifecycleState: string;
  timeCreated: string;
  definedTags?: { "Oracle-Tags"?: { CreatedBy?: string } };
}

/** How one Worker log line reads: the hunt goes on, Oracle has no room, or something is wrong. */
export function classify(line: string): "idle" | "capacity" | "launched" | "failure" {
  if (/: nothing launched$/.test(line)) return "idle";
  if (/^launched /.test(line)) return "launched";
  if (/^no launch \(.+\): HTTP 500 InternalError Out of host capacity\.?$/.test(line)) return "capacity";
  // Oracle throttling is part of the hunt too.
  if (/^no launch \(.+\): HTTP 429 /.test(line)) return "capacity";
  return "failure";
}

/** Launches by the launcher's user created since `since` that Oracle then terminated. */
export function droppedLaunches(instances: Instance[], since: Date): Instance[] {
  return instances.filter(
    (instance) =>
      instance.definedTags?.["Oracle-Tags"]?.CreatedBy === "default/joutiya-launcher" &&
      ["TERMINATING", "TERMINATED"].includes(instance.lifecycleState) &&
      new Date(instance.timeCreated) >= since,
  );
}

export interface Verdict {
  status: "ok" | "done" | "anomaly";
  reasons: string[];
}

export function verdict(input: { alive: Instance[]; dropped: Instance[]; lines: string[]; workerFound: boolean; cron: boolean; tailSeconds: number }): Verdict {
  const reasons: string[] = [];
  const spares = input.alive.filter((instance) => instance.shape === MICRO).length;
  const main = input.alive.some((instance) => instance.shape === A1);
  if (!input.workerFound) reasons.push(`Worker ${WORKER} not found`);
  else if (!input.cron) reasons.push("Worker has no cron trigger");
  if (input.dropped.length > 0) reasons.push(`${input.dropped.length} launch(es) dropped by Oracle: ${input.dropped.map((i) => `${i.displayName ?? i.shape} ${i.timeCreated}`).join(", ")}`);
  const failures = input.lines.filter((line) => classify(line) === "failure");
  if (failures.length > 0) reasons.push(`failure lines: ${[...new Set(failures)].join(" | ")}`);
  if (input.workerFound && input.cron && input.lines.length === 0 && input.tailSeconds >= 120) reasons.push(`no Worker run seen in ${input.tailSeconds} s`);
  if (reasons.length > 0) return { status: "anomaly", reasons };
  if (main && spares >= SPARES) return { status: "done", reasons: ["joutiya-vm and both spares live: delete the Worker and joutiya-launcher (rebrand plan)"] };
  return { status: "ok", reasons: [] };
}

async function oracle(hours: number): Promise<{ alive: Instance[]; dropped: Instance[] }> {
  const credentials: OciCredentials = {
    tenancy: requireOwnerVar("OCI_TENANCY"),
    user: requireOwnerVar("OCI_USER"),
    fingerprint: requireOwnerVar("OCI_FINGERPRINT"),
    region: requireOwnerVar("OCI_REGION"),
    privateKey: Buffer.from(requireOwnerVar("OCI_KEY_B64"), "base64").toString("utf8"),
  };
  const url = new URL(`https://iaas.${credentials.region}.oraclecloud.com/20160918/instances?compartmentId=${encodeURIComponent(requireOwnerVar("OCI_COMPARTMENT"))}&limit=100`);
  const response = await fetch(url, { headers: signedHeaders(credentials, "GET", url, undefined) });
  if (!response.ok) throw new Error(`Oracle ListInstances: HTTP ${response.status}`);
  const instances = (await response.json()) as Instance[];
  return {
    alive: instances.filter((instance) => !["TERMINATING", "TERMINATED"].includes(instance.lifecycleState)),
    dropped: droppedLaunches(instances, new Date(Date.now() - hours * 3_600_000)),
  };
}

async function cloudflare(tailSeconds: number): Promise<{ workerFound: boolean; cron: boolean; lines: string[] }> {
  const token = requireOwnerVar("CLOUDFLARE_API_TOKEN");
  const registry = JSON.parse(readFileSync(new URL("../infra/targets.json", import.meta.url), "utf8")) as { shared: { cloudflare: { accountId: string } } };
  const base = `https://api.cloudflare.com/client/v4/accounts/${registry.shared.cloudflare.accountId}/workers/scripts/${WORKER}`;
  const auth = { authorization: `Bearer ${token}` };
  const schedules = await fetch(`${base}/schedules`, { headers: auth });
  if (schedules.status === 404) return { workerFound: false, cron: false, lines: [] };
  if (!schedules.ok) throw new Error(`Cloudflare schedules: HTTP ${schedules.status}`);
  const cron = (((await schedules.json()) as { result?: { schedules?: unknown[] } }).result?.schedules ?? []).length > 0;
  const created = await fetch(`${base}/tails`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}" });
  if (!created.ok) throw new Error(`Cloudflare tail: HTTP ${created.status}`);
  const { id, url } = ((await created.json()) as { result: { id: string; url: string } }).result;
  const lines: string[] = [];
  try {
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(url, "trace-v1");
      socket.onopen = () => socket.send(JSON.stringify({ debug: false }));
      socket.onmessage = async (event) => {
        const text = typeof event.data === "string" ? event.data : await (event.data as Blob).text();
        const trace = JSON.parse(text) as { logs?: { message: unknown[] }[]; exceptions?: { message?: string }[] };
        for (const log of trace.logs ?? []) lines.push(log.message.map(String).join(" "));
        for (const exception of trace.exceptions ?? []) lines.push(`exception: ${exception.message ?? "?"}`);
      };
      socket.onerror = () => resolve();
      setTimeout(() => {
        socket.close();
        resolve();
      }, tailSeconds * 1000);
    });
  } finally {
    await fetch(`${base}/tails/${id}`, { method: "DELETE", headers: auth });
  }
  return { workerFound: true, cron, lines };
}

async function main(): Promise<void> {
  requireEnvProxy();
  const number = (name: string, fallback: number) => Number(new RegExp(`^--${name}=(\\d+)$`).exec(process.argv.find((arg) => arg.startsWith(`--${name}=`)) ?? "")?.[1] ?? fallback);
  const hours = number("hours", 2);
  const tailSeconds = number("tail-seconds", 150);
  const { alive, dropped } = await oracle(hours);
  console.log(`instances: ${alive.map((instance) => `${instance.displayName} ${instance.shape} ${instance.lifecycleState}`).join(", ") || "none"}`);
  const worker = await cloudflare(tailSeconds);
  for (const line of worker.lines) console.log(`worker: ${line}`);
  const result = verdict({ alive, dropped, ...worker, tailSeconds });
  console.log(`verdict ${result.status}${result.reasons.length > 0 ? `: ${result.reasons.join("; ")}` : ""}`);
  process.exitCode = result.status === "anomaly" ? 2 : 0;
}

if (process.argv[1]?.endsWith("vm-launcher-watch.ts")) {
  // Explicit exit: a closed tail socket can keep the event loop alive.
  main().then(
    () => process.exit(),
    (error: unknown) => {
      console.error(`vm-launcher-watch: ${(error as Error).message}`);
      process.exit(1);
    },
  );
}
