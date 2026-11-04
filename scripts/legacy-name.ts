// Former-name guard (owner, 2026-11-02; plan in the project files, rebrand-aalan/plan-zero-joutiya.md).
// A change may not add the former name: per file, the lines holding it that the change adds may
// not outnumber the ones it removes (editing such a line is fine, a new one is not). The check
// compares the working tree's HEAD with a base commit, so it does not depend on what other PRs do:
//   node scripts/legacy-name.ts --base HEAD^1   CI (merge commit of a PR, or the pushed main commit)
//   node scripts/legacy-name.ts                 local, against `git merge-base origin/main HEAD`
//   node scripts/legacy-name.ts --count         how many lines still hold it, per file
// Name the new thing Aalan instead; a line that must keep it for a while (a transition that reads
// both names) carries the marker `legacy-name: allow` and is not counted. What stays for good, once every wave is done: the redirect
// domain joutiya.ma, identifiers that cannot be renamed (Firebase project ids joutiya-dev/-staging/
// -prod, R2 buckets joutiya-*, the Access team domain joutiya.cloudflareaccess.com, the VM transfer
// certificate CN), the password blocklist and the own-host pattern of messaging links. Leftovers
// until their wave: JOUTIYA_* fallback names, VM paths and units (/etc/joutiya, joutiya-deploy...),
// @joutiya.ma addresses, *.joutiya.ma hosts.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORD = ["jou", "tiya"].join("");
/** This guard and its test name the word by design. */
const SELF = new Set(["scripts/legacy-name.ts", "scripts/legacy-name.test.ts"]);

const git = (args: string[], cwd = process.cwd()): string => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Per file, lines holding the word added minus removed, from a `git diff -U0` text. */
export function netAdditions(diff: string): Record<string, number> {
  const net: Record<string, number> = {};
  const word = new RegExp(WORD, "i");
  const allowed = /legacy-name: allow/;
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) file = null;
    else if (line.startsWith("+++ ")) file = line === "+++ /dev/null" ? null : line.slice(6);
    else if (line.startsWith("--- ")) continue;
    else if (file && !SELF.has(file) && (line.startsWith("+") || line.startsWith("-")) && word.test(line) && !allowed.test(line)) {
      net[file] = (net[file] ?? 0) + (line.startsWith("+") ? 1 : -1);
    }
  }
  // A file deleted by the change only removes lines: nothing to count against it.
  return net;
}

/** The files where the change adds the word, with how many lines. */
export function problems(net: Record<string, number>): string[] {
  return Object.entries(net)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, count]) => `${file}: ${count} new line(s) with the former name (name it Aalan)`);
}

export function diffAgainst(base: string, cwd = process.cwd()): string {
  return git(["diff", "-U0", "--no-color", "--no-ext-diff", "--text", base, "HEAD"], cwd);
}

/** Lines still holding the word, per tracked text file (binaries skipped). */
export function countLines(cwd = process.cwd()): Record<string, number> {
  try {
    const out = git(["grep", "-c", "-z", "-i", "-I", "--fixed-strings", WORD], cwd);
    const counts: Record<string, number> = {};
    for (const line of out.split("\n")) {
      const [file, count] = line.split("\0");
      if (file && !SELF.has(file)) counts[file] = Number(count);
    }
    return counts;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return {};
    throw error;
  }
}

function resolveBase(argv: string[]): string | null {
  const index = argv.indexOf("--base");
  if (index >= 0) return argv[index + 1] ?? null;
  try {
    return git(["merge-base", "origin/main", "HEAD"]).trim() || null;
  } catch {
    return null;
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--count")) {
    const counts = countLines();
    for (const [file, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) console.log(`${count}\t${file}`);
    console.log(`legacy name: ${Object.values(counts).reduce((sum, count) => sum + count, 0)} lines in ${Object.keys(counts).length} files`);
    return;
  }
  const base = resolveBase(argv);
  if (!base) {
    console.log("legacy name: no base commit (origin/main unknown), skipped");
    return;
  }
  const found = problems(netAdditions(diffAgainst(base)));
  if (found.length > 0) {
    console.error(found.join("\n"));
    process.exit(1);
  }
  console.log("legacy name: no new occurrence");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
