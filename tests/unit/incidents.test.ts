import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatLine, namespaceId } from "../../scripts/incidents";

describe("incidents script", () => {
  it("reads the STATE namespace of the probe Worker", () => {
    expect(namespaceId(readFileSync("workers/uptime-probe/wrangler.jsonc", "utf8"))).toMatch(/^[0-9a-f]{32}$/);
    expect(() => namespaceId("{}")).toThrow(/no STATE namespace id/);
  });

  it("prints one line per incident with its state", () => {
    const at = Date.UTC(2026, 10, 2, 17, 40);
    expect(formatLine({ name: "incident:20261102T1740-abc", metadata: { s: "P0", t: "production : hors ligne", at } })).toBe(
      "20261102T1740-abc  P0   2026-11-02 17:40 UTC  OPEN              production : hors ligne",
    );
    expect(formatLine({ name: "incident:x", metadata: { s: "P1", t: "t", at, x: 1 } })).toContain("OPEN, owner paged");
    expect(formatLine({ name: "incident:x", metadata: { s: "P1", t: "t", at, a: 1, x: 1 } })).toContain("acked");
    expect(formatLine({ name: "incident:x" })).toBe("x  (no metadata)");
  });
});
