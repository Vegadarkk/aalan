import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEXT_PATCHES, NEXT_RUNTIME_DIR, applyNextPatches, patchRuntimeFiles } from "../../src/server/next-patches.ts";

// The patches of the Next server runtime (src/server/next-patches.ts, applied to the standalone
// output by scripts/patch-next-runtime.ts): each statement must still exist, once, in the
// installed Next (a Next upgrade that rewrites it fails here, not silently in production), and
// the files must be patched in place, once.

const runtimeDir = join(process.cwd(), NEXT_RUNTIME_DIR);

describe("Next runtime patches", () => {
  const runtimes = readdirSync(runtimeDir).filter((file) => /^app-page.*\.runtime\.prod\.js$/.test(file));

  it("targets the App Router runtime bundles of the installed Next", () => {
    expect([...runtimes].sort()).toEqual(["app-page-experimental.runtime.prod.js", "app-page-turbo-experimental.runtime.prod.js", "app-page-turbo.runtime.prod.js", "app-page.runtime.prod.js"]);
    for (const file of runtimes) expect(NEXT_PATCHES.every((patch) => patch.file.test(join(runtimeDir, file))), file).toBe(true);
    expect(NEXT_PATCHES.some((patch) => patch.file.test(join(runtimeDir, "pages.runtime.prod.js")))).toBe(false);
    expect(NEXT_PATCHES.some((patch) => patch.file.test(join(runtimeDir, "app-page.runtime.dev.js")))).toBe(false);
  });

  for (const file of runtimes) {
    it(`finds every statement once in ${file} and rewrites it`, () => {
      const path = join(runtimeDir, file);
      const source = readFileSync(path, "utf8");
      const result = applyNextPatches(path, source);
      expect(result.missing).toEqual([]);
      expect(result.present).toEqual([]);
      expect(result.applied).toHaveLength(NEXT_PATCHES.length);
      for (const patch of NEXT_PATCHES) {
        expect(result.source.split(patch.replace)).toHaveLength(2);
        expect(result.source).not.toContain(patch.find);
      }
      // Rewritten statements only: the rest of the file is byte for byte the same.
      expect(result.source.length - source.length).toBe(NEXT_PATCHES.reduce((sum, patch) => sum + patch.replace.length - patch.find.length, 0));
      // A second pass finds the patch in place and changes nothing.
      expect(applyNextPatches(path, result.source)).toMatchObject({ source: result.source, applied: [], present: NEXT_PATCHES, missing: [] });
    });
  }

  it("reports a file without the statement, and ignores files it does not target", () => {
    const path = join(runtimeDir, "app-page.runtime.prod.js");
    const twice = "let i=JSON.stringify(t).length;if(r.fetchCache&&i>2097152;let i=JSON.stringify(t).length;if(r.fetchCache&&i>2097152";
    expect(applyNextPatches(path, twice)).toMatchObject({ source: twice, applied: [], present: [], missing: NEXT_PATCHES });
    expect(applyNextPatches(path, "nothing here")).toMatchObject({ applied: [], present: [], missing: NEXT_PATCHES });
    expect(applyNextPatches(join(runtimeDir, "pages.runtime.prod.js"), "let i=JSON.stringify(t).length;if(r.fetchCache&&i>2097152")).toMatchObject({ applied: [], present: [], missing: [] });
  });

  it("patches the runtime files of a build output in place, once, and fails on a missing statement", () => {
    const root = mkdtempSync(join(tmpdir(), "next-patches-"));
    const dir = join(root, NEXT_RUNTIME_DIR);
    mkdirSync(dir, { recursive: true });
    const statement = "module.exports=function(r,t){let i=JSON.stringify(t).length;if(r.fetchCache&&i>2097152){return -1}return i}";
    writeFileSync(join(dir, "app-page-turbo.runtime.prod.js"), statement);
    writeFileSync(join(dir, "app-page.runtime.prod.js"), statement);
    writeFileSync(join(dir, "pages.runtime.prod.js"), statement);
    const first = patchRuntimeFiles(root);
    expect(first.map((report) => [report.file.slice(dir.length + 1), report.applied.length, report.present.length])).toEqual([
      ["app-page-turbo.runtime.prod.js", 1, 0],
      ["app-page.runtime.prod.js", 1, 0],
    ]);
    const patched = readFileSync(join(dir, "app-page-turbo.runtime.prod.js"), "utf8");
    expect(patched).toBe("module.exports=function(r,t){let i=r.fetchCache?JSON.stringify(t).length:0;if(r.fetchCache&&i>2097152){return -1}return i}");
    expect(readFileSync(join(dir, "pages.runtime.prod.js"), "utf8")).toBe(statement);
    // Idempotent.
    const second = patchRuntimeFiles(root);
    expect(second.map((report) => [report.applied.length, report.present.length])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(readFileSync(join(dir, "app-page-turbo.runtime.prod.js"), "utf8")).toBe(patched);
    // A changed Next: the build stops.
    writeFileSync(join(dir, "app-page.runtime.prod.js"), "module.exports={}");
    expect(() => patchRuntimeFiles(root)).toThrow(/statement not found/);
    expect(() => patchRuntimeFiles(mkdtempSync(join(tmpdir(), "next-patches-empty-")))).toThrow();
  });
});
