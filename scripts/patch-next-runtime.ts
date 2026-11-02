// Applies src/server/next-patches.ts to the standalone build output (.next/standalone), after
// `next build` and before the Docker image copies it: `node scripts/patch-next-runtime.ts [root]`.
// The repository's node_modules is never touched (the dev server runs another runtime file).
// Idempotent; fails when a statement is not found (the build stops: see next-patches.ts).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchRuntimeFiles } from "../src/server/next-patches.ts";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../.next/standalone", import.meta.url)));
if (!existsSync(root)) {
  console.error(`patch-next-runtime: ${root} not found: run \`next build\` first`);
  process.exit(1);
}
for (const report of patchRuntimeFiles(root)) {
  const state = report.applied.length > 0 ? `patched: ${report.applied.join("; ")}` : `already patched: ${report.present.join("; ")}`;
  console.warn(`patch-next-runtime: ${report.file.slice(root.length + 1)}: ${state}`);
}
