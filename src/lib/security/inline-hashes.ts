// Hash-based CSP for public ISR pages (§6). Next.js inlines the RSC payload as <script> tags
// whose content changes with every render, so their hashes are computed on the rendered HTML,
// once per response, by src/server/csp-hash-hook.ts. The cached HTML and its CSP header then
// travel together through Cloudflare's cache.
//
// Only scripts the framework emits are hashed, each checked on its whole body, so an HTML
// injection that slipped past React escaping still cannot run: it gets no hash and the browser
// blocks it (and reports it to /api/csp-report).
//
// The page is scanned as UTF-8 bytes, never decoded as a whole (a 250 KB page took ~1.5 ms of
// CPU to decode and to run the regular expressions below over). The byte scanners keep exactly
// the semantics of the regular expressions they stand for, which stay here as the specification;
// tests/unit/inline-hashes.test.tsx checks both agree.

import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { EXAMPLES_SCRIPT } from "../examples/script.ts";
import { THEME_SCRIPT } from "../theme/script.ts";
import { WELCOME_SCRIPT } from "../welcome/script.ts";
import { ADSENSE_SCRIPT_HOSTS, TURNSTILE_ORIGIN } from "./csp.ts";

export { INLINE_HASH_MARKER } from "./csp.ts";

/** Specification of the tag scan: `/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi` (ASCII case folding). */
const SRC = /\bsrc\s*=/i;
const TYPE = /\btype\s*=\s*["']?([^"'\s>]+)/i;
const JS_TYPES = new Set(["", "module", "text/javascript", "application/javascript"]);

/** A JSON string literal: no unescaped quote, so nothing can follow it inside the call. */
const JSON_STRING = String.raw`"(?:[^"\\\n\r]|\\.)*"`;
/** Comma-separated JSON string literals (possibly none). */
const JSON_STRINGS = String.raw`(?:${JSON_STRING}(?:,${JSON_STRING})*)?`;
/** Comma-separated non-negative integers (possibly none). */
const INTEGERS = String.raw`(?:\d+(?:,\d+)*)?`;

/**
 * Whole-body shapes of the scripts Next.js emits in prerendered HTML. The first two are checked
 * on bytes by isBootstrap and isPayloadPush; the Turbopack runtime bootstrap (Next.js 16.4+,
 * <script id="_R_">: chunk paths and numeric module ids only) is short and decoded.
 */
const RSC_BOOTSTRAP = /^\(self\.__next_f=self\.__next_f\|\|\[\]\)\.push\(\[0\]\)(?:;self\.__next_f\.push\(\[2,null\]\))?$/;
const RSC_PAYLOAD_PUSH = new RegExp(String.raw`^self\.__next_f\.push\(\[\d,(?:null|${JSON_STRING})\]\)$`);
const TURBOPACK_BOOTSTRAP = new RegExp(
  String.raw`^\(globalThis\["TURBOPACK"\] \|\| \(globalThis\["TURBOPACK"\] = \[\]\)\)\.push\(\{"otherChunks":\[${JSON_STRINGS}\],"runtimeModuleIds":\[${INTEGERS}\]\}\);?$`,
);

/** The regular expressions the byte scanners implement, for the tests. */
export const SCRIPT_SHAPES = { RSC_BOOTSTRAP, RSC_PAYLOAD_PUSH, TURBOPACK_BOOTSTRAP } as const;

const LT = 0x3c;
const GT = 0x3e;
const QUOTE = 0x22;
const COMMA = 0x2c;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const CLOSE_PAREN = 0x29;
const LF = 0x0a;
const CR = 0x0d;
const OPEN_TAG = Buffer.from("<script");
const CLOSE_TAG = Buffer.from("</script");
const BOOTSTRAP = Buffer.from("(self.__next_f=self.__next_f||[]).push([0])");
const BOOTSTRAP_WITH_HINT = Buffer.from("(self.__next_f=self.__next_f||[]).push([0]);self.__next_f.push([2,null])");
const PUSH_OPEN = Buffer.from("self.__next_f.push([");
const PUSH_NULL = Buffer.from("null])");
const WHITESPACE_ONLY = /^\s*$/;

/** `\w` of a regular expression without the u flag: ASCII letters, digits and underscore. */
function isWordByte(byte: number | undefined): boolean {
  return byte !== undefined && ((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte === 0x5f);
}

/** `tag` (lowercase ASCII) at `at`, folding ASCII case only, as the i flag does without the u flag. */
function tagAt(bytes: Buffer, at: number, tag: Buffer): boolean {
  if (at + tag.length > bytes.length) return false;
  for (let i = 0; i < tag.length; i++) {
    const expected = tag[i] as number;
    const byte = bytes[at + i] as number;
    if (byte === expected) continue;
    const letter = expected >= 0x61 && expected <= 0x7a;
    if (!letter || (byte | 0x20) !== expected) return false;
  }
  return true;
}

/** Index of the first `<script` at or after `from`, or -1. */
function nextOpenTag(bytes: Buffer, from: number): number {
  for (let at = bytes.indexOf(LT, from); at >= 0; at = bytes.indexOf(LT, at + 1)) if (tagAt(bytes, at, OPEN_TAG)) return at;
  return -1;
}

/** Start and end of the first `</script\s*>` at or after `from`, or null when none follows. */
function nextCloseTag(bytes: Buffer, from: number): [start: number, end: number] | null {
  for (let at = bytes.indexOf(LT, from); at >= 0; at = bytes.indexOf(LT, at + 1)) {
    if (!tagAt(bytes, at, CLOSE_TAG)) continue;
    const afterName = at + CLOSE_TAG.length;
    const gt = bytes.indexOf(GT, afterName);
    if (gt < 0) return null;
    if (gt === afterName || WHITESPACE_ONLY.test(bytes.toString("utf8", afterName, gt))) return [at, gt + 1];
  }
  return null;
}

/** `\r\n` and `\r` become `\n`, as browsers normalize a script before hashing it. */
function normalizeNewlines(bytes: Buffer): Buffer {
  const out = Buffer.allocUnsafe(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    if (byte === CR) {
      out[length++] = LF;
      if (bytes[i + 1] === LF) i += 1;
    } else {
      out[length++] = byte;
    }
  }
  return out.subarray(0, length);
}

export function scriptHash(body: string | Buffer): string {
  // Browsers hash the text after newline normalization.
  if (typeof body === "string") return createHash("sha256").update(body.replace(/\r\n?/g, "\n"), "utf8").digest("base64");
  // Browsers hash the decoded text: bytes that are not UTF-8 (never seen from React) go the string way.
  if (!isUtf8(body)) return scriptHash(body.toString("utf8"));
  return createHash("sha256")
    .update(body.indexOf(CR) < 0 ? body : normalizeNewlines(body))
    .digest("base64");
}

/** Our own constant inline scripts (string literals: same hash in every build). */
export const PINNED_SCRIPT_HASHES: ReadonlySet<string> = new Set([scriptHash(THEME_SCRIPT), scriptHash(WELCOME_SCRIPT), scriptHash(EXAMPLES_SCRIPT)]);

/** RSC_BOOTSTRAP on bytes. */
function isBootstrap(body: Buffer): boolean {
  return body.equals(BOOTSTRAP) || body.equals(BOOTSTRAP_WITH_HINT);
}

/**
 * RSC_PAYLOAD_PUSH on bytes: `self.__next_f.push([` + digit + `,` + (`null` or a JSON string
 * literal) + `])`. Inside the literal: no unescaped quote, backslash or newline; a backslash takes
 * the next character, which `.` forbids to be a line terminator (\n, \r, U+2028, U+2029). Bytes
 * above 0x7f are never ASCII, so skipping one byte after a backslash matches `.` on code units.
 */
function isPayloadPush(body: Buffer): boolean {
  const length = body.length;
  let i = PUSH_OPEN.length;
  if (length < i + 2 || !body.subarray(0, i).equals(PUSH_OPEN)) return false;
  const digit = body[i] as number;
  if (digit < 0x30 || digit > 0x39 || body[i + 1] !== COMMA) return false;
  i += 2;
  if (body[i] !== QUOTE) return length === i + PUSH_NULL.length && body.subarray(i).equals(PUSH_NULL);
  for (i += 1; ; i++) {
    if (i >= length) return false;
    const byte = body[i] as number;
    if (byte === QUOTE) break;
    if (byte === LF || byte === CR) return false;
    if (byte === BACKSLASH) {
      i += 1;
      if (i >= length) return false;
      const escaped = body[i] as number;
      if (escaped === LF || escaped === CR) return false;
      if (escaped === 0xe2 && body[i + 1] === 0x80 && (body[i + 2] === 0xa8 || body[i + 2] === 0xa9)) return false;
    }
  }
  return length === i + 3 && body[i + 1] === CLOSE_BRACKET && body[i + 2] === CLOSE_PAREN;
}

export function isFrameworkScript(body: string | Buffer, hash = scriptHash(body)): boolean {
  if (PINNED_SCRIPT_HASHES.has(hash)) return true;
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return isBootstrap(bytes) || isPayloadPush(bytes) || TURBOPACK_BOOTSTRAP.test(bytes.toString("utf8"));
}

export interface InlineScripts {
  /** Base64 SHA-256 of the trusted inline scripts, in document order, deduplicated. */
  hashes: string[];
  /** Executable inline scripts left unhashed (blocked by the browser). */
  untrusted: number;
}

export function inlineScripts(html: string | Buffer): InlineScripts {
  const bytes = typeof html === "string" ? Buffer.from(html, "utf8") : html;
  const hashes = new Set<string>();
  let untrusted = 0;
  let from = 0;
  for (;;) {
    const open = nextOpenTag(bytes, from);
    if (open < 0) break;
    const attributesStart = open + OPEN_TAG.length;
    const tagEnd = bytes.indexOf(GT, attributesStart);
    // No `>` ahead: no later tag can match either.
    if (tagEnd < 0) break;
    // `<script\b`: a word character after the name is another tag name.
    if (isWordByte(bytes[attributesStart])) {
      from = open + 1;
      continue;
    }
    const close = nextCloseTag(bytes, tagEnd + 1);
    // No closing tag ahead: no later script can match either.
    if (close === null) break;
    from = close[1];
    const attributes = bytes.toString("utf8", attributesStart, tagEnd);
    if (SRC.test(attributes)) continue;
    const type = (TYPE.exec(attributes)?.[1] ?? "").toLowerCase();
    // Data blocks (application/ld+json...) never execute: script-src does not apply to them.
    if (!JS_TYPES.has(type)) continue;
    const body = bytes.subarray(tagEnd + 1, close[0]);
    const hash = scriptHash(body);
    if (isFrameworkScript(body, hash)) hashes.add(hash);
    else untrusted += 1;
  }
  return { hashes: [...hashes], untrusted };
}

/**
 * Replaces the script-src directive with 'self' plus the given hashes; keeps 'unsafe-eval' (dev),
 * the Turnstile origin (the phone reveal of the public listing page may escalate to a challenge)
 * and the AdSense hosts when the policy lists them (phase 6, D10).
 */
export function withScriptHashes(policy: string, hashes: string[]): string {
  return policy
    .split(";")
    .map((directive) => {
      const trimmed = directive.trim();
      if (!/^script-src\s/i.test(trimmed)) return trimmed;
      const sources = trimmed.split(/\s+/);
      const extra = [TURNSTILE_ORIGIN, "'unsafe-eval'", ...ADSENSE_SCRIPT_HOSTS].filter((source) => sources.includes(source));
      return ["script-src", "'self'", ...hashes.map((hash) => `'sha256-${hash}'`), ...extra].join(" ");
    })
    .filter(Boolean)
    .join("; ");
}
