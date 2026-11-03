import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { consoleCloudInit } from "../../scripts/oracle-vm";

const path = new URL("../../infra/console-cloud-init.sh", import.meta.url);
const text = readFileSync(path, "utf8");
const body = /<< 'JOUTIYA_BOOTSTRAP' \| gunzip > \/root\/joutiya-bootstrap\.sh\n([\s\S]*?)\nJOUTIYA_BOOTSTRAP\n/.exec(text)?.[1] ?? "";
const userData = body.replace(/\n/g, "");

describe("infra/console-cloud-init.sh", () => {
  it("is what console-init writes for its user data, small enough for the console's metadata", () => {
    // consoleCloudInit throws past OCI's 32,000 bytes once base64-encoded.
    expect(text).toBe(consoleCloudInit(userData));
    expect(spawnSync("bash", ["-n", path.pathname]).status).toBe(0);
  });

  it("carries the current bootstrap.sh with no tunnel token (rerun `node scripts/oracle-vm.ts console-init` after a change)", () => {
    const script = gunzipSync(Buffer.from(userData, "base64")).toString("utf8");
    for (const name of ["SSH", "STAGING", "PROD"]) expect(script).toContain(`\n${name}_TUNNEL_TOKEN='none'\n`);
    const template = script
      .replace(/^(SSH|STAGING|PROD)_TUNNEL_TOKEN='none'$/gm, "$1_TUNNEL_TOKEN='__JOUTIYA_$1_TUNNEL_TOKEN__'")
      .replace(/^VM_FILES='[A-Za-z0-9+/=]+'$/m, "VM_FILES='__JOUTIYA_VM_FILES__'");
    expect(template).toBe(readFileSync(new URL("../../infra/vm/bootstrap.sh", import.meta.url), "utf8"));
  });
});
