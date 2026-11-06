import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { moduleType, PATTERN, WORKER, workerFiles } from "./holding-page.ts";

const root = new URL("../workers/holding-page/", import.meta.url);

test("the Worker and its route keep their names", () => {
  assert.equal(WORKER, "aalan-attente");
  assert.equal(PATTERN, "aalan.ma/*");
});

test("pages and styles are text modules, fonts and images data modules", () => {
  assert.equal(moduleType("index.js"), "application/javascript+module");
  assert.equal(moduleType("site/fr.html"), "text/plain");
  assert.equal(moduleType("site/launch.css"), "text/plain");
  assert.equal(moduleType("site/glints.txt"), "text/plain");
  assert.equal(moduleType("site/fonts/a.woff2"), "application/octet-stream");
  assert.equal(moduleType("site/og.png"), "application/octet-stream");
});

test("every module the Worker imports is uploaded", () => {
  const files = new Set(workerFiles());
  for (const source of ["index.js", "manifest.js"]) {
    for (const [, file = ""] of readFileSync(new URL(source, root), "utf8").matchAll(/from "\.\/([^"]+)"/g)) {
      assert.ok(files.has(file), `${source} imports ${file}, which is not uploaded`);
      assert.ok(existsSync(new URL(file, root)), `${file} is missing`);
    }
  }
});

test("the pages hold no script and keep the door", () => {
  for (const page of ["site/fr.html", "site/ar.html"]) {
    const html = readFileSync(new URL(page, root), "utf8");
    // One script only: the gate's waves of light, served by the Worker itself.
    assert.deepEqual(html.match(/<script[^>]*>/g), ['<script src="/hold/glints.js" defer>']);
    assert.match(html, /data-welcome-part="door"/);
    assert.match(html, /reseaux@aalan\.ma/);
  }
});
