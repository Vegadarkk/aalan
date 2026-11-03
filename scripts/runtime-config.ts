// Writes part of Firestore `config/flags` or `config/pricing` of one environment from a JSON file, with
// the gcloud sign-in of scripts/google-wif.ts `login` (as scripts/legal-config.ts). Only the top-level
// keys the file holds are written (PATCH with an update mask): the others stay as they are.
// - flags: each key is one flag (src/config/flags.ts), e.g. {"salesEnabled": true}.
// - pricing: each top-level key of PricingConfig (src/config/pricing.ts) is written whole, as the app
//   merges the document over DEFAULT_PRICING at the top level only. The file may hold a partial value:
//   objects are merged over the defaults and lists of objects by `id`, e.g.
//   {"plans": {"essentiel": {"stripePrices": {"monthly": "price_..."}}}, "passes": [{"id": "boutique30", "stripePrice": "price_..."}]}
//   writes the full `plans` and `passes` with these ids. Values already in Firestore under these
//   keys are replaced, not merged.
// Opening sales in production is the sales gate (spec §10): refused here.
//
//   node scripts/runtime-config.ts <staging|prod> <flags|pricing> <file.json> [--apply]     dry run without --apply

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveFlagsConfig } from "../src/config/flags.ts";
import { DEFAULT_PRICING, resolvePricingConfig } from "../src/config/pricing.ts";
import { validateTargets, type Targets } from "./assert-target.ts";
import { requireEnvProxy } from "./env-proxy.ts";
import { firestoreFields } from "./firestore-rest.ts";
import { gcloudAccessToken } from "./google-wif.ts";

export type RuntimeDoc = "flags" | "pricing";

export interface RuntimePlan {
  /** Top-level fields to write, whole. */
  write: Record<string, unknown>;
  errors: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** `value` over `base`: objects key by key, lists of objects by `id`; anything else replaces. */
export function mergeOver(base: unknown, value: unknown): unknown {
  if (isRecord(base) && isRecord(value)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, item] of Object.entries(value)) merged[key] = key in base ? mergeOver(base[key], item) : item;
    return merged;
  }
  if (Array.isArray(base) && Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === "string")) {
    const merged = base.map((item) => {
      const match = isRecord(item) ? value.find((entry) => (entry as { id: string }).id === item.id) : undefined;
      return match === undefined ? item : mergeOver(item, match);
    });
    const added = value.filter((entry) => !base.some((item) => isRecord(item) && item.id === (entry as { id: string }).id));
    return [...merged, ...added];
  }
  return value;
}

export function planRuntime(env: "staging" | "prod", doc: RuntimeDoc, stored: unknown): RuntimePlan {
  if (!isRecord(stored) || Object.keys(stored).length === 0) return { write: {}, errors: ["the file must hold a non-empty JSON object"] };
  if (doc === "flags") {
    const { errors } = resolveFlagsConfig(stored);
    if (env === "prod" && stored.salesEnabled === true) errors.push("salesEnabled: opening sales in production is the sales gate, not this script");
    return { write: { ...stored }, errors };
  }
  const defaults = DEFAULT_PRICING as unknown as Record<string, unknown>;
  const errors: string[] = [];
  const write: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!(key in defaults)) errors.push(`${key}: unknown pricing key`);
    else write[key] = mergeOver(defaults[key], value);
  }
  if (errors.length === 0) errors.push(...resolvePricingConfig(write).errors);
  return { write, errors };
}

/** Firestore REST update mask of a PATCH that writes only `keys` (each quoted, as keys may hold any character). */
export function updateMaskQuery(keys: string[]): string {
  return keys.map((key) => `updateMask.fieldPaths=${encodeURIComponent(`\`${key.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``)}`).join("&");
}

async function main(): Promise<void> {
  requireEnvProxy();
  const [env, doc, file] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const apply = process.argv.includes("--apply");
  if ((env !== "staging" && env !== "prod") || (doc !== "flags" && doc !== "pricing") || !file) {
    throw new Error("usage: scripts/runtime-config.ts <staging|prod> <flags|pricing> <file.json> [--apply]");
  }

  const raw: unknown = JSON.parse(readFileSync(new URL("../infra/targets.json", import.meta.url), "utf8"));
  const targetErrors = validateTargets(raw);
  if (targetErrors.length > 0) throw new Error(targetErrors.join("\n"));
  const projectId = (raw as Targets).environments[env].firebase.projectId;
  if (!projectId) throw new Error(`environments.${env}.firebase.projectId must be recorded in infra/targets.json first`);

  const { write, errors } = planRuntime(env, doc, JSON.parse(readFileSync(file, "utf8")));
  if (errors.length > 0) throw new Error(`invalid config/${doc}:\n  ${errors.join("\n  ")}`);
  console.log(JSON.stringify(write, null, 2));
  if (!apply) {
    console.log(`\nDry run: nothing written. Add --apply to write these keys of config/${doc} in ${projectId}.`);
    return;
  }
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/${doc}?${updateMaskQuery(Object.keys(write))}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${gcloudAccessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: firestoreFields(write) }),
  });
  if (!response.ok) throw new Error(`Firestore answered HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  console.log(`\nconfig/${doc} (${Object.keys(write).join(", ")}) written in ${projectId}. The app picks it up within 5 minutes.`);
}

const self = fileURLToPath(import.meta.url);
if (/[\\/]runtime-config\.(?:ts|mjs)$/.test(self) && process.argv[1] !== undefined && realpathSync(process.argv[1]) === self) {
  main().catch((error: unknown) => {
    console.error(`runtime-config: ${(error as Error).message}`);
    process.exit(1);
  });
}
