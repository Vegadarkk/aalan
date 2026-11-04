import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BASELINE_PATH, compare, countLegacyLines, type Baseline } from "./legacy-name.ts";

test("a file over its count or missing from the baseline fails; one under it can be lowered", () => {
  const baseline = { "a.ts": 2, "b.md": 1, "gone.ts": 3 };
  assert.deepEqual(compare(baseline, { "a.ts": 2, "b.md": 1 }), { problems: [], lowered: ["gone.ts"] });
  assert.deepEqual(compare(baseline, { "a.ts": 1, "b.md": 1, "gone.ts": 3 }), { problems: [], lowered: ["a.ts"] });
  assert.deepEqual(compare(baseline, { "a.ts": 3, "b.md": 1, "gone.ts": 3, "new.ts": 1 }), {
    problems: ["a.ts: 3 lines with the former name, 2 allowed (name it Aalan)", "new.ts: 1 new line(s) with the former name (name it Aalan)"],
    lowered: [],
  });
});

test("the repository holds no occurrence beyond the committed baseline", () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  assert.deepEqual(compare(baseline.files, countLegacyLines()).problems, []);
});
