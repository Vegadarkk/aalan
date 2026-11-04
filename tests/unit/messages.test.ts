import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import rif from "../../messages/rif.json";
import { loadMessages } from "@/i18n/messages";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [nested, text] of flatten(value, path)) out.set(nested, text);
  }
  return out;
}

// An argument's name, not the text of a plural or select branch (`one {annonce}`, `=0 {…}`).
const placeholders = (text: string) => [...text.matchAll(/(?<!\b(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)/g)].map((match) => match[1]).sort();
const french = flatten(fr);
// Language names are endonyms, identical in every interface: kept in French only.
const SHARED = /^Locale\.(names|short)\./;

describe("messages", () => {
  it("translates every French key into Arabic", () => {
    expect([...flatten(ar).keys()].sort()).toEqual([...french.keys()].filter((key) => !SHARED.test(key)).sort());
  });

  it("translates every French key into Tarifit", () => {
    // Owner, 3 Nov 2026: the whole interface is offered in Tarifit (native review before launch).
    expect([...flatten(rif).keys()].sort()).toEqual([...french.keys()].filter((key) => !SHARED.test(key)).sort());
  });

  it("keeps the same ICU placeholders in every language", () => {
    for (const messages of [ar, rif]) {
      for (const [key, text] of flatten(messages)) expect(placeholders(text), key).toEqual(placeholders(french.get(key) ?? ""));
    }
  });

  it("merges Tarifit over French", async () => {
    const merged = flatten((await loadMessages("rif")) as unknown as Tree);
    expect([...merged.keys()].sort()).toEqual([...french.keys()].sort());
  });
});
