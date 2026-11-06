import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVideoResource, parseArgs, videoContentType } from "./youtube.ts";

const base = { title: "La porte s'ouvre", description: "Petites annonces au Maroc.", tags: ["aalan", " maroc ", ""], privacy: "private" as const, synthetic: true };

test("builds a private, not-for-kids video with the AI disclosure", () => {
  const { resource, errors } = buildVideoResource(base);
  assert.deepEqual(errors, []);
  assert.equal(resource?.status.privacyStatus, "private");
  assert.equal(resource?.status.selfDeclaredMadeForKids, false);
  assert.equal(resource?.status.containsSyntheticMedia, true);
  assert.deepEqual(resource?.snippet.tags, ["aalan", "maroc"]);
});

test("rejects what YouTube would refuse", () => {
  assert.match(buildVideoResource({ ...base, title: " " }).errors.join(), /--title is required/);
  assert.match(buildVideoResource({ ...base, title: "x".repeat(101) }).errors.join(), /YouTube allows 100/);
  assert.match(buildVideoResource({ ...base, description: "<b>" }).errors.join(), /< and >/);
  assert.match(buildVideoResource({ ...base, privacy: "secret" as never }).errors.join(), /--privacy/);
});

test("parses flags and file types", () => {
  const { positional, flags } = parseArgs(["clip.mp4", "--title", "Hello", "--synthetic", "--apply"]);
  assert.deepEqual(positional, ["clip.mp4"]);
  assert.equal(flags.get("title"), "Hello");
  assert.equal(flags.get("synthetic"), true);
  assert.equal(flags.get("apply"), true);
  assert.equal(videoContentType("A.MP4"), "video/mp4");
  assert.equal(videoContentType("a.gif"), undefined);
});
