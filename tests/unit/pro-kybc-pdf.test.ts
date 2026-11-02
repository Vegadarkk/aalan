import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_OBJECT_STREAMS, pdfHasActiveContentDeep } from "@/lib/pro/kybc-pdf";

// KYBC PDFs: active content hidden in a compressed object stream (security review, 2 Nov 2026).

function pdf(...parts: (string | Buffer)[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part, "latin1") : part))));
}

function objectStream(number: number, content: string, dictionary = "/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode"): (string | Buffer)[] {
  const data = deflateSync(Buffer.from(content, "latin1"));
  return [`${number} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`, data, "\nendstream\nendobj\n"];
}

const head = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
const tail = "trailer\n<< /Root 1 0 R >>\n%%EOF\n";

describe("pdfHasActiveContentDeep", () => {
  it("passes a document whose object streams hold plain dictionaries", () => {
    expect(pdfHasActiveContentDeep(pdf(head, ...objectStream(3, "2 0 << /Type /Pages /Kids [] /Count 0 >>"), tail))).toBe(false);
  });

  it("finds an open action or a script inside a compressed object stream", () => {
    expect(pdfHasActiveContentDeep(pdf(head, ...objectStream(3, "5 0 << /OpenAction 6 0 R >>"), tail))).toBe(true);
    expect(pdfHasActiveContentDeep(pdf(head, ...objectStream(3, "6 0 << /S /J#61vaScript /JS (app.alert(1)) >>"), tail))).toBe(true);
    // An escaped /ObjStm name in the stream dictionary is still an object stream.
    expect(pdfHasActiveContentDeep(pdf(head, ...objectStream(3, "5 0 << /OpenAction 6 0 R >>", "/Type /Obj#53tm /N 1 /First 4 /Filter /FlateDecode"), tail))).toBe(true);
  });

  it("refuses object streams it cannot inspect: another filter, corrupt data, too many", () => {
    expect(pdfHasActiveContentDeep(pdf(head, "3 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /ASCIIHexDecode >>\nstream\n3c3c3e3e\nendstream\nendobj\n", tail))).toBe(true);
    expect(pdfHasActiveContentDeep(pdf(head, "3 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\nnot zlib\nendstream\nendobj\n", tail))).toBe(true);
    const many = Array.from({ length: MAX_OBJECT_STREAMS + 1 }, (_, index) => objectStream(10 + index, "2 0 << /Count 0 >>")).flat();
    expect(pdfHasActiveContentDeep(pdf(head, ...many, tail))).toBe(true);
  });

  it("ignores ordinary content streams (pages, images) and still sees raw tokens", () => {
    const page = deflateSync(Buffer.from("BT /F1 12 Tf (OpenAction) Tj ET", "latin1"));
    expect(pdfHasActiveContentDeep(pdf(head, `4 0 obj\n<< /Filter /FlateDecode /Length ${page.length} >>\nstream\n`, page, "\nendstream\nendobj\n", tail))).toBe(false);
    expect(pdfHasActiveContentDeep(pdf(head, "5 0 obj\n<< /OpenAction 6 0 R >>\nendobj\n", tail))).toBe(true);
  });
});
