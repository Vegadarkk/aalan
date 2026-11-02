// Patches of the Next.js server runtime, applied to the standalone build output by
// scripts/patch-next-runtime.ts (part of `npm run build`, so the Docker image gets them). Each
// patch replaces one exact statement of one known file, exactly once; a file whose text no longer
// matches fails the build loudly instead of silently losing the patch, and
// tests/unit/next-patches.test.ts checks the statements against the installed Next, so a Next
// upgrade that rewrites them fails `npm run check` first. Pure: no I/O but patchRuntimeFiles.
//
// 1. IncrementalCache.set sizes every entry with JSON.stringify(data).length, a size only read to
//    refuse fetch cache entries over 2 MB (`r.fetchCache`). For a page (APP_PAGE) it stringifies
//    the HTML and the RSC payload (a Buffer, which JSON turns into an array of numbers) on every
//    render: about 10 of the 64 ms of CPU of an uncached public page (profile of 2 Nov 2026,
//    docs/lancement/charge.md). Patched, the size is computed for fetch cache entries only; the
//    variable is read nowhere else.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface NextPatch {
  /** Why, for the messages. */
  name: string;
  /** The file's path (the runtime bundles of the App Router: turbo or webpack, stable or experimental). */
  file: RegExp;
  /** Exact text, expected once in the file. */
  find: string;
  replace: string;
}

export const NEXT_PATCHES: readonly NextPatch[] = [
  {
    name: "IncrementalCache.set: size fetch cache entries only",
    file: /[\\/]next[\\/]dist[\\/]compiled[\\/]next-server[\\/]app-page(?:-turbo)?(?:-experimental)?\.runtime\.prod\.js$/,
    find: "let i=JSON.stringify(t).length;if(r.fetchCache&&i>2097152",
    replace: "let i=r.fetchCache?JSON.stringify(t).length:0;if(r.fetchCache&&i>2097152",
  },
];

export interface PatchResult {
  source: string;
  /** Patches applied (each exactly once). */
  applied: NextPatch[];
  /** Patches of this file already in place (a second run). */
  present: NextPatch[];
  /** Patches of this file whose text was found neither once as is nor as replaced. */
  missing: NextPatch[];
}

/** Applies the patches of `path` to `source`; pure. */
export function applyNextPatches(path: string, source: string, patches: readonly NextPatch[] = NEXT_PATCHES): PatchResult {
  const result: PatchResult = { source, applied: [], present: [], missing: [] };
  for (const patch of patches) {
    if (!patch.file.test(path)) continue;
    const parts = result.source.split(patch.find);
    if (parts.length === 2) {
      result.source = parts.join(patch.replace);
      result.applied.push(patch);
    } else if (parts.length === 1 && result.source.split(patch.replace).length === 2) {
      result.present.push(patch);
    } else {
      result.missing.push(patch);
    }
  }
  return result;
}

/** The runtime bundles of the App Router, under a node_modules/next of `root`. */
export const NEXT_RUNTIME_DIR = "node_modules/next/dist/compiled/next-server";

export interface FileReport {
  file: string;
  applied: string[];
  present: string[];
  missing: string[];
}

/**
 * Patches the runtime files under `root` (a standalone output, or a node_modules tree) in place
 * and reports each. Throws when no file is found or a statement is missing: the build must fail
 * rather than ship the unpatched cost unnoticed.
 */
export function patchRuntimeFiles(root: string, patches: readonly NextPatch[] = NEXT_PATCHES): FileReport[] {
  const dir = join(root, NEXT_RUNTIME_DIR);
  const files = readdirSync(dir)
    .map((file) => join(dir, file))
    .filter((file) => patches.some((patch) => patch.file.test(file)));
  if (files.length === 0) throw new Error(`next-patches: no runtime file in ${dir}`);
  const reports: FileReport[] = [];
  for (const file of files) {
    const result = applyNextPatches(file, readFileSync(file, "utf8"), patches);
    if (result.missing.length > 0) {
      throw new Error(`next-patches: statement not found in ${file}: ${result.missing.map((patch) => patch.name).join("; ")} (Next changed; update src/server/next-patches.ts or drop the patch)`);
    }
    if (result.applied.length > 0) writeFileSync(file, result.source);
    reports.push({ file, applied: result.applied.map((patch) => patch.name), present: result.present.map((patch) => patch.name), missing: [] });
  }
  return reports;
}
