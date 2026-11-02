import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerVar, requireOwnerVar } from "./owner-env.ts";

test("AALAN_* first, then the former JOUTIYA_* name, never the unprefixed one", () => {
  assert.equal(ownerVar("CLOUDFLARE_API_TOKEN", { AALAN_CLOUDFLARE_API_TOKEN: " new ", JOUTIYA_CLOUDFLARE_API_TOKEN: "old" }), "new");
  assert.equal(ownerVar("CLOUDFLARE_API_TOKEN", { AALAN_CLOUDFLARE_API_TOKEN: " ", JOUTIYA_CLOUDFLARE_API_TOKEN: "old" }), "old");
  assert.equal(ownerVar("CLOUDFLARE_API_TOKEN", { CLOUDFLARE_API_TOKEN: "other project" }), "");
  assert.throws(() => requireOwnerVar("CLOUDFLARE_API_TOKEN", {}), /AALAN_CLOUDFLARE_API_TOKEN is not set/);
});
