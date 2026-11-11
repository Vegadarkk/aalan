// spare-micro-1, the Always Free E2.1.Micro (1 GB) put to work for Aalan (docs/micro-vm.md): uptime
// probe of aalan.ma from outside Cloudflare Workers and aalan-vm, and a copy outside Cloudflare of
// the encrypted backups and of the public media. Files in infra/micro. Driven through OCI Run Command
// as the agent's user ocarun: the VM has no SSH key, no ingress rule and no sudo for ocarun, and no
// link to aalan-vm. Only spare-micro-1 is ever touched (never spare-micro-2). Dry run unless --apply.
//
//   node scripts/micro-vm.ts status
//       instance state, shape, public IP, Oracle Cloud Agent plugins (read only).
//   node scripts/micro-vm.ts sync [--apply]
//       installs infra/micro for ocarun (scripts, pinned rclone, crontab: probe every minute, mirror
//       at 05:15 UTC).
//   node scripts/micro-vm.ts report
//       probe results of the last 24 h, mirror state, edge certificate, disk, updates; last line
//       "verdict ok" or "verdict ALERT ..." (read only, also runs without --apply).
//   node scripts/micro-vm.ts r2-keys [--apply]
//       writes the read-only R2 key of the mirror (AALAN_R2_MICRO_ACCESS_KEY_ID and
//       AALAN_R2_MICRO_SECRET_ACCESS_KEY, Cloudflare token "Object Read" on aalan-prod-private and
//       aalan-prod-media only) to a file only ocarun reads. Never prints a value; the text stays 7 days
//       in Oracle's Run Command record, readable by the tenancy's administrators and Claude's OCI user.
//   node scripts/micro-vm.ts mirror-now [--apply]
//       runs the mirror once, now (the first copy, or after a failure).
//   node scripts/micro-vm.ts reboot [--apply]
//       soft reboot through the OCI API (pending kernel updates: ocarun cannot reboot).
//
// Environment: AALAN_OCI_* (or their former names), like scripts/oracle-vm.ts.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateTargets, type Targets } from "./assert-target.ts";
import { requireEnvProxy } from "./env-proxy.ts";
import { Oci, credentialsFromEnv, query, runCommand } from "./oracle-vm.ts";
import { ownerVar, requireOwnerVar } from "./owner-env.ts";

export const MICRO = { name: "spare-micro-1", shape: "VM.Standard.E2.1.Micro" } as const;
/** The other free micro: never a target of this script (owner's rule). */
export const FORBIDDEN = ["spare-micro-2"] as const;
export const MICRO_ROOT = "/var/lib/ocarun/aalan";
const SYNC_DIR = "/var/lib/ocarun/aalan-sync";
const RUN_COMMAND_MAX_BYTES = 4_000;

interface Instance {
  id: string;
  displayName: string;
  shape: string;
  lifecycleState: string;
}

/** The one live spare-micro-1 of the compartment, checked by name and shape; anything else throws. */
export function pickMicro(instances: Instance[]): Instance {
  const live = instances.filter((instance) => !["TERMINATING", "TERMINATED"].includes(instance.lifecycleState));
  const found = live.filter((instance) => instance.displayName === MICRO.name);
  if (found.length !== 1 || !found[0]) throw new Error(`expected one live ${MICRO.name}, found ${found.length}: nothing done`);
  const [micro] = found;
  if ((FORBIDDEN as readonly string[]).includes(micro.displayName)) throw new Error(`${micro.displayName} is not ours`);
  if (micro.shape !== MICRO.shape) throw new Error(`${MICRO.name} has shape ${micro.shape}, not ${MICRO.shape}: nothing done`);
  return micro;
}

/** A script run as ocarun (no sudo), inside Run Command's text limit. */
export function ocarunCommand(script: string): string {
  const text = ["#!/bin/bash", "set -euo pipefail", "umask 077", script.replace(/\n+$/, ""), ""].join("\n");
  const bytes = Buffer.byteLength(text);
  if (bytes > RUN_COMMAND_MAX_BYTES) throw new Error(`command is ${bytes} bytes, Run Command allows ${RUN_COMMAND_MAX_BYTES}`);
  return text;
}

/** `sync` as Run Command texts: the bundle in chunks, checked against its SHA-256, then infra/micro/install.sh. */
export function microSyncCommands(bundle: string, chunkSize = 3_500): string[] {
  if (!/^[A-Za-z0-9+/=]+$/.test(bundle)) throw new Error("the bundle is not base64");
  const file = `${SYNC_DIR}/bundle.b64`;
  const chunks = bundle.match(new RegExp(`.{1,${chunkSize}}`, "g")) ?? [];
  const append = chunks.map((chunk, index) =>
    ocarunCommand(
      [
        ...(index === 0 ? [`install -d -m 0700 ${SYNC_DIR}`, `: > ${file}`] : []),
        `printf '%s' '${chunk}' >> ${file}`,
        `echo "chunk ${index + 1}/${chunks.length}: $(wc -c < ${file}) bytes"`,
      ].join("\n"),
    ),
  );
  const sha256 = createHash("sha256").update(bundle).digest("hex");
  const install = ocarunCommand(
    [
      `trap 'rm -rf "\${files:-}" ${SYNC_DIR}' EXIT`,
      `echo "${sha256}  ${file}" | sha256sum -c --quiet`,
      'files="$(mktemp -d)"',
      `base64 -d ${file} | tar -xzf - -C "$files"`,
      'bash "$files/infra/micro/install.sh" "$files/infra/micro"',
    ].join("\n"),
  );
  return [...append, install];
}

export interface R2Values {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  privateBucket: string;
  mediaBucket: string;
}

/** Writes secrets/r2.env (0600, ocarun) from checked values; prints nothing of them. */
export function r2EnvScript(values: R2Values): string {
  if (!/^[0-9a-f]{32}$/.test(values.accessKeyId)) throw new Error("AALAN_R2_MICRO_ACCESS_KEY_ID is not an R2 access key ID (32 hex characters)");
  if (!/^[0-9a-f]{64}$/.test(values.secretAccessKey)) throw new Error("AALAN_R2_MICRO_SECRET_ACCESS_KEY is not an R2 secret access key (64 hex characters)");
  if (!/^https:\/\/[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com$/.test(values.endpoint)) throw new Error("unexpected R2 endpoint");
  for (const bucket of [values.privateBucket, values.mediaBucket]) if (!/^aalan-prod-[a-z]+$/.test(bucket)) throw new Error(`bucket ${bucket} is not an aalan-prod bucket`);
  const lines = [
    `R2_ACCESS_KEY_ID='${values.accessKeyId}'`,
    `R2_SECRET_ACCESS_KEY='${values.secretAccessKey}'`,
    `R2_ENDPOINT='${values.endpoint}'`,
    `R2_BUCKET_PRIVATE='${values.privateBucket}'`,
    `R2_BUCKET_MEDIA='${values.mediaBucket}'`,
  ];
  return ocarunCommand(
    [
      `install -d -m 0700 ${MICRO_ROOT}/secrets`,
      `cat > ${MICRO_ROOT}/secrets/.r2.env.new << 'R2_ENV_END'`,
      ...lines,
      "R2_ENV_END",
      `mv ${MICRO_ROOT}/secrets/.r2.env.new ${MICRO_ROOT}/secrets/r2.env`,
      `echo "r2.env: $(stat -c '%a %U' ${MICRO_ROOT}/secrets/r2.env), ${lines.length} names"`,
    ].join("\n"),
  );
}

function bundle(): string {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tar = spawnSync("tar", ["-czf", "-", "--owner=0", "--group=0", "-C", root, "infra/micro"], { maxBuffer: 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);
  return tar.stdout.toString("base64");
}

async function micro(oci: Oci, compartmentId: string): Promise<Instance> {
  const instance = pickMicro(await oci.call<Instance[]>("GET", "iaas", `/20160918/instances${query({ compartmentId })}`));
  if (instance.lifecycleState !== "RUNNING") throw new Error(`${MICRO.name} is ${instance.lifecycleState}, not RUNNING`);
  return instance;
}

async function status(oci: Oci, compartmentId: string): Promise<void> {
  const instance = pickMicro(await oci.call<Instance[]>("GET", "iaas", `/20160918/instances${query({ compartmentId })}`));
  console.log(`instance ${instance.displayName} ${instance.lifecycleState} ${instance.shape}`);
  const attachments = await oci.call<{ vnicId: string; lifecycleState: string }[]>("GET", "iaas", `/20160918/vnicAttachments${query({ compartmentId, instanceId: instance.id })}`);
  for (const attachment of attachments.filter((item) => item.lifecycleState === "ATTACHED")) {
    const vnic = await oci.call<{ privateIp?: string; publicIp?: string; nsgIds?: string[] }>("GET", "iaas", `/20160918/vnics/${attachment.vnicId}`);
    console.log(`vnic     private ${vnic.privateIp ?? "-"} public ${vnic.publicIp ?? "-"} nsg ${vnic.nsgIds?.length ?? 0}`);
  }
  if (instance.lifecycleState !== "RUNNING") return;
  const plugins = await oci.call<{ name: string; status: string }[]>("GET", "iaas", `/20180530/instanceagents/${instance.id}/plugins${query({ compartmentId })}`);
  for (const plugin of plugins.filter((item) => item.status !== "NOT_SUPPORTED")) console.log(`plugin   ${plugin.name}: ${plugin.status}`);
}

async function main(): Promise<void> {
  requireEnvProxy();
  const args = process.argv.slice(2);
  const [action, ...rest] = args.filter((arg) => !arg.startsWith("--"));
  const actions = ["status", "sync", "report", "r2-keys", "mirror-now", "reboot"];
  if (!action || !actions.includes(action) || rest.length > 0) throw new Error(`usage: scripts/micro-vm.ts <${actions.join("|")}> [--apply]`);
  const raw: unknown = JSON.parse(readFileSync(new URL("../infra/targets.json", import.meta.url), "utf8"));
  const errors = validateTargets(raw);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const targets = raw as Targets;
  const credentials = credentialsFromEnv();
  const { tenancyId, userId, compartmentId, homeRegion } = targets.shared.oracle;
  if (credentials.tenancy !== tenancyId || credentials.user !== userId || credentials.region !== homeRegion || ownerVar("OCI_COMPARTMENT") !== compartmentId) {
    throw new Error("AALAN_OCI_* do not match shared.oracle in infra/targets.json: nothing done");
  }
  const oci = new Oci(credentials, args.includes("--apply"));
  const compartment = compartmentId as string;
  if (action === "status") return status(oci, compartment);
  const instance = await micro(oci, compartment);
  if (action === "report") {
    // The installed copy (sync): the report of what runs there.
    console.log((await runCommand(oci, compartment, instance.id, "aalan-micro report", ocarunCommand(`bash ${MICRO_ROOT}/bin/report.sh`), 300, true)).trimEnd());
    return;
  }
  if (action === "sync") {
    const commands = microSyncCommands(bundle());
    for (const [index, text] of commands.entries()) {
      const output = await runCommand(oci, compartment, instance.id, `aalan-micro sync ${index + 1}/${commands.length}`, text, 600);
      if (output) console.log(output.trimEnd());
    }
  } else if (action === "r2-keys") {
    const account = targets.shared.cloudflare.accountId;
    const r2 = targets.environments.prod.r2;
    const script = r2EnvScript({
      accessKeyId: requireOwnerVar("R2_MICRO_ACCESS_KEY_ID"),
      secretAccessKey: requireOwnerVar("R2_MICRO_SECRET_ACCESS_KEY"),
      endpoint: `https://${account}.eu.r2.cloudflarestorage.com`,
      privateBucket: r2.private ?? "",
      mediaBucket: r2.media ?? "",
    });
    const output = await runCommand(oci, compartment, instance.id, "aalan-micro r2-keys", script, 300);
    if (output) console.log(output.trimEnd());
  } else if (action === "mirror-now") {
    const output = await runCommand(oci, compartment, instance.id, "aalan-micro mirror", ocarunCommand(`${MICRO_ROOT}/bin/mirror.sh || true\ncat ${MICRO_ROOT}/state/mirror.status`), 3_300);
    if (output) console.log(output.trimEnd());
  } else if (action === "reboot") {
    await oci.write("POST", `/20160918/instances/${instance.id}${query({ action: "SOFTRESET" })}`, undefined, { action: "SOFTRESET", instance: MICRO.name });
  }
  console.log(oci.apply ? "\nDone." : "\nDry run: nothing written. Add --apply to send these requests.");
}

const self = fileURLToPath(import.meta.url);
if (/[\\/]micro-vm\.(?:ts|mjs)$/.test(self) && process.argv[1] !== undefined && realpathSync(process.argv[1]) === self) {
  main().catch((error: unknown) => {
    console.error(`micro-vm: ${(error as Error).message}`);
    process.exit(1);
  });
}
