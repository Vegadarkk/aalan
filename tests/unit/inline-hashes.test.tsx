import { createHash } from "node:crypto";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeScript } from "@/components/layout/theme-script";
import { inlineScripts, isFrameworkScript, PINNED_SCRIPT_HASHES, SCRIPT_SHAPES, scriptHash, withScriptHashes, type InlineScripts } from "@/lib/security/inline-hashes";
import { EXAMPLES_SCRIPT } from "@/lib/examples/script";

const sha = (text: string) => createHash("sha256").update(text).digest("base64");
const BOOT = "(self.__next_f=self.__next_f||[]).push([0])";
const CHUNK = 'self.__next_f.push([1,"0:{\\"a\\":\\"\\u003cb\\u003e\\"}\\n"])';
// Exact shape emitted by Next.js 16.4.2 (Turbopack) in prerendered HTML.
const TURBOPACK =
  '(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":["static/chunks/3_1kpbd8aih6c.js","static/chunks/063al_q720fkj.js"],"runtimeModuleIds":[94553]});';

describe("inlineScripts", () => {
  it("hashes the framework scripts and skips external and data scripts", () => {
    const html = `<script>${BOOT}</script><script src="/_next/a.js"></script><script type="application/ld+json">{"a":1}</script><script>${CHUNK}</script>`;
    expect(inlineScripts(html)).toEqual({ hashes: [sha(BOOT), sha(CHUNK)], untrusted: 0 });
  });

  it("leaves injected scripts unhashed, even disguised as framework scripts", () => {
    const injected = [
      "alert(1)",
      'self.__next_f.push([1,"x"]);alert(1)',
      'self.__next_f.push([1,"x"]),alert(1),(["y"])',
      `${BOOT};alert(1)`,
    ];
    const html = injected.map((body) => `<script>${body}</script>`).join("");
    expect(inlineScripts(html)).toEqual({ hashes: [], untrusted: injected.length });
  });

  it("hashes the Turbopack runtime bootstrap of Next.js 16.4", () => {
    expect(inlineScripts(`<script id="_R_">${TURBOPACK}</script>`)).toEqual({ hashes: [sha(TURBOPACK)], untrusted: 0 });
    expect(isFrameworkScript(TURBOPACK.slice(0, -1))).toBe(true);
    expect(isFrameworkScript('(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":[],"runtimeModuleIds":[]});')).toBe(true);
  });

  it("rejects Turbopack look-alikes", () => {
    const forged = [
      `${TURBOPACK}alert(1)`,
      TURBOPACK.replace("[94553]", '["x"]'),
      TURBOPACK.replace("[94553]", "[94553],\"x\":[1]"),
      TURBOPACK.replace('"static/chunks/3_1kpbd8aih6c.js"', '"a"+alert(1)+"b"'),
      TURBOPACK.replace('"static/chunks/3_1kpbd8aih6c.js"', '"a\\\\"+alert(1)+"b"'),
    ];
    expect(inlineScripts(forged.map((body) => `<script>${body}</script>`).join(""))).toEqual({ hashes: [], untrusted: forged.length });
  });

  it("normalizes newlines like browsers and deduplicates", () => {
    const body = 'self.__next_f.push([1,"a"])';
    expect(scriptHash(`${body}\r\n`)).toBe(sha(`${body}\n`));
    expect(inlineScripts(`<script>${BOOT}</script><SCRIPT>${BOOT}</SCRIPT>`).hashes).toEqual([sha(BOOT)]);
  });

  it("counts module and javascript types as executable", () => {
    expect(inlineScripts('<script type="module">alert(1)</script><script type="text/javascript">alert(2)</script>').untrusted).toBe(2);
  });
});

describe("pinned scripts", () => {
  it("trusts the theme script exactly as rendered", () => {
    const html = renderToString(<ThemeScript nonce="n" />);
    const { hashes, untrusted } = inlineScripts(html);
    expect(untrusted).toBe(0);
    expect(hashes).toHaveLength(1);
    expect(PINNED_SCRIPT_HASHES.has(hashes[0] ?? "")).toBe(true);
  });

  it("does not trust a modified theme script", () => {
    const html = renderToString(<ThemeScript />).replace("catch(_){}", "catch(_){alert(1)}");
    expect(inlineScripts(html)).toEqual({ hashes: [], untrusted: 1 });
    expect(isFrameworkScript("alert(1)")).toBe(false);
  });
});

describe("withScriptHashes", () => {
  it("replaces script-src with 'self' and the hashes", () => {
    const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'";
    expect(withScriptHashes(policy, ["AAA=", "BBB="])).toBe("default-src 'self'; script-src 'self' 'sha256-AAA=' 'sha256-BBB='; object-src 'none'");
  });

  it("keeps 'unsafe-eval' when present (dev)", () => {
    expect(withScriptHashes("script-src 'self' 'unsafe-inline' 'unsafe-eval'", [])).toBe("script-src 'self' 'unsafe-eval'");
  });

  it("keeps the Turnstile origin and drops the other hosts", () => {
    const policy = "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com/gsi/client";
    expect(withScriptHashes(policy, ["AAA="])).toBe("script-src 'self' 'sha256-AAA=' https://challenges.cloudflare.com");
  });
});

// The byte scanners of inline-hashes.ts implement these regular expressions (the specification):
// the reference below is the former string implementation, kept to prove both agree, on the
// shapes the framework emits and on random documents (escapes, newlines, U+2028, bytes that are
// not UTF-8, tags in any case, whitespace before the closing bracket).
describe("byte scanner", () => {
  const REFERENCE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  function referenceInlineScripts(html: string): InlineScripts {
    const hashes = new Set<string>();
    let untrusted = 0;
    for (const match of html.matchAll(REFERENCE_SCRIPT)) {
      const attributes = match[1] ?? "";
      if (/\bsrc\s*=/i.test(attributes)) continue;
      const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1] ?? "").toLowerCase();
      if (!["", "module", "text/javascript", "application/javascript"].includes(type)) continue;
      const body = match[2] ?? "";
      const hash = sha(body.replace(/\r\n?/g, "\n"));
      if (PINNED_SCRIPT_HASHES.has(hash) || Object.values(SCRIPT_SHAPES).some((shape) => shape.test(body))) hashes.add(hash);
      else untrusted += 1;
    }
    return { hashes: [...hashes], untrusted };
  }

  // Deterministic generator (xorshift), so a failure reproduces.
  let seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const times = <T,>(max: number, make: () => T): T[] => Array.from({ length: Math.floor(random() * (max + 1)) }, make);

  const STRING_PARTS = ['a', 'é', '\\"', "\\\\", "\\n", "\\u2028", "\u2028", "\u2029", "\\\u2028", "\\\u2029", "\\", '"', "\n", "\r", "\r\n", "\t", "<", ">", "&", "0:{\\\"a\\\":1}\n", "😀", "\\😀"];
  const jsonString = () => `"${times(8, () => pick(STRING_PARTS)).join("")}"`;
  const payload = () => `self.__next_f.push([${pick(["1", "3", "0", "12", "x", ""])},${pick([jsonString, jsonString, jsonString, () => "null", () => "nul", () => jsonString() + jsonString()])()}])${pick(["", "", "", ";", "\n", " "])}`;
  const bootstrap = () => `(self.__next_f=self.__next_f||[]).push([0])${pick(["", "", ";self.__next_f.push([2,null])", ";self.__next_f.push([2,\"x\"])", ";alert(1)"])}`;
  const turbopack = () => `(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":[${times(3, () => jsonString()).join(",")}],"runtimeModuleIds":[${times(3, () => pick(["1", "94553", "x"])).join(",")}]})${pick(["", ";", ";;"])}`;
  const BODIES = [payload, payload, payload, bootstrap, turbopack, () => "alert(1)", () => "", () => EXAMPLES_SCRIPT, () => `${EXAMPLES_SCRIPT};alert(1)`, () => "</scrip", () => "a</script b>c"];
  const OPEN = ["<script", "<SCRIPT", "<Script", "<scripts", "<script-x", "<scrip", "<\u017fcript"];
  const ATTRIBUTES = ["", "", " ", ' id="_R_"', ' src="/a.js"', " src=x", ' type="module"', " type=text/javascript", ' type="application/ld+json"', ' TYPE="Application/JSON"', ' data-x="<"', "\n", " <script", ' nonce="n"'];
  const CLOSE = ["</script>", "</script>", "</SCRIPT>", "</script >", "</script\t\n>", "</script\u00a0>", "</script\u2028>", "</script x>", "</scripts>", "</script", ""];
  const document = () => times(6, () => `${pick(["", "<p>text</p>", "text", "<", "<s", "</", ">"])}${pick(OPEN)}${pick(ATTRIBUTES)}${pick(["", ">"])}${pick(BODIES)()}${pick(CLOSE)}`).join("");

  it("agrees with the reference on the framework's scripts", () => {
    const html = `<!doctype html><html><head><script>${EXAMPLES_SCRIPT}</script><script src="/_next/a.js" async=""></script><script id="_R_">${TURBOPACK}</script></head><body><script>${BOOT}</script><script>${CHUNK}</script><script type="application/ld+json">{"@context":"https://schema.org"}</script><script>self.__next_f.push([1,"é \\u2028 \\n"])</script></body></html>`;
    const expected = referenceInlineScripts(html);
    expect(expected).toEqual({ hashes: [sha(EXAMPLES_SCRIPT), sha(TURBOPACK), sha(BOOT), sha(CHUNK), sha('self.__next_f.push([1,"é \\u2028 \\n"])')], untrusted: 0 });
    expect(inlineScripts(html)).toEqual(expected);
    expect(inlineScripts(Buffer.from(html, "utf8"))).toEqual(expected);
  });

  it("agrees with the reference on random documents", () => {
    for (let i = 0; i < 3000; i++) {
      const html = document();
      const bytes = Buffer.from(html, "utf8");
      expect(inlineScripts(bytes), html).toEqual(referenceInlineScripts(bytes.toString("utf8")));
    }
  });

  it("agrees with the reference on random script bodies", () => {
    for (let i = 0; i < 3000; i++) {
      const body = pick(BODIES)();
      const expected = PINNED_SCRIPT_HASHES.has(sha(body.replace(/\r\n?/g, "\n"))) || Object.values(SCRIPT_SHAPES).some((shape) => shape.test(body));
      expect(isFrameworkScript(body), body).toBe(expected);
      expect(isFrameworkScript(Buffer.from(body, "utf8")), body).toBe(expected);
    }
  });

  it("agrees with the reference on bytes that are not UTF-8", () => {
    const junk = [Buffer.from([0xc3]), Buffer.from([0xe2, 0x80]), Buffer.from([0xe2, 0x80, 0xa8]), Buffer.from([0xff, 0xfe]), Buffer.from([0x80]), Buffer.from([0xf0, 0x9f, 0x98])];
    for (let i = 0; i < 2000; i++) {
      const parts: Buffer[] = [];
      for (const piece of times(5, () => `${pick(OPEN)}${pick(ATTRIBUTES)}>${pick(BODIES)()}`)) {
        const at = Math.floor(random() * (piece.length + 1));
        parts.push(Buffer.from(piece.slice(0, at), "utf8"), pick(junk), Buffer.from(piece.slice(at), "utf8"), Buffer.from(pick(CLOSE), "utf8"));
      }
      const bytes = Buffer.concat(parts);
      expect(inlineScripts(bytes), bytes.toString("hex")).toEqual(referenceInlineScripts(bytes.toString("utf8")));
    }
  });

  it("hashes a body with carriage returns like the reference", () => {
    const body = Buffer.from('self.__next_f.push([1,"a\\r\\n"])\r\n\r\n\r', "utf8");
    expect(scriptHash(body)).toBe(sha(body.toString("utf8").replace(/\r\n?/g, "\n")));
  });
});
