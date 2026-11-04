import assert from "node:assert/strict";
import { test } from "node:test";
import { netAdditions, problems } from "./legacy-name.ts";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  '-const host = "staging.joutiya.ma"; // old',
  '+const host = "staging.joutiya.ma"; // edited, still one line',
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -0,0 +1,2 @@",
  '+const key = "Joutiya.review";',
  "+const other = 1;",
  '+headers["X-Joutiya-Signature"] = signature; // legacy-name: allow',
  "diff --git a/src/c.ts b/src/c.ts",
  "--- a/src/c.ts",
  "+++ b/src/c.ts",
  "@@ -1 +1 @@",
  '-const key = "joutiya.x";',
  '+const key = "aalan.x";',
  "diff --git a/old.md b/old.md",
  "--- a/old.md",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-Joutiya",
  "diff --git a/scripts/legacy-name.ts b/scripts/legacy-name.ts",
  "--- a/scripts/legacy-name.ts",
  "+++ b/scripts/legacy-name.ts",
  "@@ -0,0 +1 @@",
  "+// joutiya by design",
].join("\n");

test("an edited line holding the name passes, a new one fails, a removed one counts down", () => {
  assert.deepEqual(netAdditions(diff), { "src/a.ts": 0, "src/b.ts": 1, "src/c.ts": -1 });
  assert.deepEqual(problems(netAdditions(diff)), ["src/b.ts: 1 new line(s) with the former name (name it Aalan)"]);
});

test("a diff without the name has nothing to report", () => {
  assert.deepEqual(problems(netAdditions("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b")), []);
});
