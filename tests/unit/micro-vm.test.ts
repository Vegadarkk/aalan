import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MICRO, MICRO_ROOT, microSyncCommands, ocarunCommand, pickMicro, r2EnvScript } from "../../scripts/micro-vm";

const instance = (displayName: string, shape: string = MICRO.shape, lifecycleState = "RUNNING") => ({ id: `ocid.${displayName}`, displayName, shape, lifecycleState });

describe("pickMicro", () => {
  it("picks spare-micro-1 and nothing else", () => {
    const picked = pickMicro([instance("aalan-vm", "VM.Standard.A1.Flex"), instance("spare-micro-2"), instance("spare-micro-1")]);
    expect(picked.displayName).toBe("spare-micro-1");
  });
  it("refuses when spare-micro-1 is missing, doubled or of another shape", () => {
    expect(() => pickMicro([instance("spare-micro-2"), instance("aalan-vm", "VM.Standard.A1.Flex")])).toThrow(/found 0/);
    expect(() => pickMicro([instance("spare-micro-1"), instance("spare-micro-1")])).toThrow(/found 2/);
    expect(() => pickMicro([instance("spare-micro-1", "VM.Standard.A1.Flex")])).toThrow(/shape/);
  });
  it("ignores a terminated namesake", () => {
    expect(pickMicro([instance("spare-micro-1", MICRO.shape, "TERMINATED"), instance("spare-micro-1")]).lifecycleState).toBe("RUNNING");
  });
});

describe("ocarunCommand", () => {
  it("runs without sudo and keeps Run Command's limit", () => {
    const text = ocarunCommand("echo hi");
    expect(text).not.toMatch(/sudo/);
    expect(text).toMatch(/^#!\/bin\/bash\nset -euo pipefail\numask 077\n/);
    expect(() => ocarunCommand("x".repeat(4_000))).toThrow(/Run Command allows/);
  });
});

describe("microSyncCommands", () => {
  it("rebuilds the bundle and checks its SHA-256 before installing", () => {
    const bundle = Buffer.from("a".repeat(9_000)).toString("base64");
    const commands = microSyncCommands(bundle);
    expect(commands.length).toBe(Math.ceil(bundle.length / 3_500) + 1);
    const rebuilt = commands
      .slice(0, -1)
      .map((text) => /printf '%s' '([^']+)'/.exec(text)?.[1] ?? "")
      .join("");
    expect(rebuilt).toBe(bundle);
    expect(commands.at(-1)).toContain(createHash("sha256").update(bundle).digest("hex"));
    expect(commands.at(-1)).toContain('infra/micro/install.sh" "$files/infra/micro"');
  });
  it("refuses anything but base64", () => {
    expect(() => microSyncCommands("abc'; rm -rf /")).toThrow(/base64/);
  });
});

describe("r2EnvScript", () => {
  const values = {
    accessKeyId: "ab".repeat(16),
    secretAccessKey: "cd".repeat(32),
    endpoint: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
    privateBucket: "aalan-prod-private",
    mediaBucket: "aalan-prod-media",
  };
  it("writes a root-of-ocarun file and echoes no value", () => {
    const script = r2EnvScript(values);
    expect(script).toContain(`${MICRO_ROOT}/secrets/r2.env`);
    const echoes = script.split("\n").filter((line) => line.startsWith("echo"));
    for (const line of echoes) for (const value of [values.accessKeyId, values.secretAccessKey]) expect(line).not.toContain(value);
  });
  it("refuses malformed keys and foreign buckets", () => {
    expect(() => r2EnvScript({ ...values, accessKeyId: "x'; id" })).toThrow(/access key ID/);
    expect(() => r2EnvScript({ ...values, secretAccessKey: "short" })).toThrow(/secret access key/);
    expect(() => r2EnvScript({ ...values, mediaBucket: "punk-records-media" })).toThrow(/aalan-prod/);
    expect(() => r2EnvScript({ ...values, endpoint: "https://evil.example" })).toThrow(/endpoint/);
  });
});

describe("infra/micro scripts", () => {
  const root = mkdtempSync(join(tmpdir(), "micro-"));
  const scripts = (name: string): string => {
    const file = join(root, name);
    writeFileSync(file, readFileSync(join("infra/micro", name), "utf8").replaceAll(MICRO_ROOT, join(root, "aalan")));
    return file;
  };
  it("report flags repeated recent failures and a stopped probe, not a single blip", () => {
    for (const dir of ["state", "data/probe", "mirror/backups", "mirror/media"]) mkdirSync(join(root, "aalan", dir), { recursive: true });
    const now = Math.floor(Date.now() / 1000);
    const day = new Date().toISOString().slice(0, 10);
    const rows = [
      [now - 120, "health", "200", "0.3", "ok"],
      [now - 60, "guide", "500", "0.3", "fail"],
      [now - 30, "www", "000", "0", "fail"],
      [now - 20, "www", "000", "0", "fail"],
    ];
    writeFileSync(join(root, "aalan/data/probe", `${day}.tsv`), rows.map((row) => row.join("\t")).join("\n") + "\n");
    const run = spawnSync("bash", [scripts("report.sh")], { encoding: "utf8", env: { ...process.env, TLS_HOST: "", APT_UPDATES: "" } });
    const verdict = run.stdout.trim().split("\n").at(-1) ?? "";
    expect(verdict).toMatch(/^verdict ALERT /);
    expect(verdict).toContain("site-failing:www");
    expect(verdict).not.toContain("site-failing:guide");
    expect(verdict).not.toContain("probe-stopped");
    expect(run.stdout).toMatch(/probe health 1\/1 ok/);
    rmSync(root, { recursive: true, force: true });
  });
});
