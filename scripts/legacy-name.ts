// Zero-Joutiya guard (owner, 2026-11-02; plan in the project files, rebrand-aalan/plan-zero-joutiya.md).
// The former name may only shrink: every tracked text file holding it is listed in
// scripts/legacy-name-baseline.json with its number of matching lines, and CI fails when a file is
// not listed or holds more lines than listed. A wave that removes names lowers the counts:
//   node scripts/legacy-name.ts            check (CI, npm run check)
//   node scripts/legacy-name.ts --update   rewrite the baseline from the working tree
// Never raise a count to get a PR green: name the new thing Aalan instead. What stays for good,
// once every wave is done: the redirect domain joutiya.ma, identifiers that cannot be renamed
// (Firebase project ids joutiya-dev/-staging/-prod, R2 buckets joutiya-*, the Access team domain
// joutiya.cloudflareaccess.com, the VM transfer certificate CN), the password blocklist and the
// own-host pattern of messaging links. Leftovers until their wave: JOUTIYA_* fallback names, VM
// paths and units (/etc/joutiya, joutiya-deploy...), @joutiya.ma addresses, *.joutiya.ma hosts.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BASELINE_PATH = "scripts/legacy-name-baseline.json";
/** This guard and its baseline name the word by design. */
const SELF = new Set(["scripts/legacy-name.ts", "scripts/legacy-name.test.ts", BASELINE_PATH]);
const WORD = ["jou", "tiya"].join("");

export interface Baseline {
  description: string;
  files: Record<string, number>;
}

/** Matching lines per tracked text file (git grep, case-insensitive, binaries skipped). */
export function countLegacyLines(cwd = process.cwd()): Record<string, number> {
  let out: string;
  try {
    out = execFileSync("git", ["grep", "-c", "-z", "-i", "-I", "--fixed-strings", WORD], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    // Exit status 1: no match at all.
    if ((error as { status?: number }).status === 1) return {};
    throw error;
  }
  const counts: Record<string, number> = {};
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [file, count] = line.split("\0");
    if (file && !SELF.has(file)) counts[file] = Number(count);
  }
  return counts;
}

/** Problems that fail CI, then files whose count went down (the baseline can be lowered). */
export function compare(baseline: Record<string, number>, current: Record<string, number>): { problems: string[]; lowered: string[] } {
  const problems: string[] = [];
  const lowered: string[] = [];
  for (const [file, count] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
    const allowed = baseline[file];
    if (allowed === undefined) problems.push(`${file}: ${count} new line(s) with the former name (name it Aalan)`);
    else if (count > allowed) problems.push(`${file}: ${count} lines with the former name, ${allowed} allowed (name it Aalan)`);
    else if (count < allowed) lowered.push(file);
  }
  for (const file of Object.keys(baseline)) if (!(file in current)) lowered.push(file);
  return { problems, lowered: lowered.sort() };
}

export function baselineOf(current: Record<string, number>, description: string): Baseline {
  const files = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  return { description, files };
}

const DESCRIPTION =
  "Lines holding the former name per file (scripts/legacy-name.ts). Counts only go down: lower them with `node scripts/legacy-name.ts --update` after a rename wave.";

function main(): void {
  const current = countLegacyLines();
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineOf(current, DESCRIPTION), null, 2)}\n`);
    const total = Object.values(current).reduce((sum, count) => sum + count, 0);
    console.log(`legacy name: baseline written, ${Object.keys(current).length} files, ${total} lines`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  const { problems, lowered } = compare(baseline.files, current);
  if (lowered.length > 0) console.log(`legacy name: ${lowered.length} file(s) under their baseline, lower it with --update: ${lowered.join(", ")}`);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("legacy name: no new occurrence");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
