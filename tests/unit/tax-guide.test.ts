import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inlineText, parseMarkdown, type MdList } from "@/lib/legal/markdown";
import { countTasks, TAX_GUIDE_ANCHORS, taxGuide } from "@/lib/guide/tax-guide";

// The tax guide in the back office (zone 7 audit P3-7): nested lists and checklists of the
// Markdown parser, and the split of docs/tax-runbook.md into anchored sections.

const list = (source: string) => parseMarkdown(source)[0] as MdList;
const texts = (block: MdList) => block.items.map(inlineText);

describe("parseMarkdown lists", () => {
  it("nests indented items under the previous item and joins wrapped lines", () => {
    const block = list(["- **Où** : le menu", "  - un trimestre", "    pour la DGI ;", "  - un mois", "- Format : CSV", "    sur deux lignes"].join("\n"));
    expect(texts(block)).toEqual(["Où : le menu", "Format : CSV sur deux lignes"]);
    expect(block.nested?.[1]).toBeNull();
    expect(texts(block.nested![0]!)).toEqual(["un trimestre pour la DGI ;", "un mois"]);
    expect(block.checked).toBeUndefined();
  });

  it("nests three levels deep and returns to the outer list", () => {
    const block = list(["- a", "  - b", "    - c", "  - d", "- e"].join("\n"));
    expect(texts(block)).toEqual(["a", "e"]);
    const inner = block.nested![0]!;
    expect(texts(inner)).toEqual(["b", "d"]);
    expect(texts(inner.nested![0]!)).toEqual(["c"]);
  });

  it("reads task items, ticked or not, and strips the box", () => {
    const block = list(["- [ ] **DGI** : inscription", "      au portail", "- [x] Rétractation", "- note"].join("\n"));
    expect(texts(block)).toEqual(["DGI : inscription au portail", "Rétractation", "note"]);
    expect(block.checked).toEqual([false, true, null]);
    expect(countTasks(block)).toEqual({ done: 1, total: 2 });
  });

  it("keeps a flat list as before: no nested or checked fields", () => {
    expect(parseMarkdown("- un\n- deux\n\nTexte.")).toEqual([
      { type: "list", ordered: false, start: 1, items: [[{ type: "text", value: "un" }], [{ type: "text", value: "deux" }]] },
      { type: "paragraph", children: [{ type: "text", value: "Texte." }] },
    ]);
  });

  it("ends a bullet list at a numbered item, as before", () => {
    const blocks = parseMarkdown("- a\n1. b");
    expect(blocks.map((block) => block.type === "list" && block.ordered)).toEqual([false, true]);
  });
});

describe("taxGuide", () => {
  const guide = taxGuide(parseMarkdown(readFileSync(path.join(process.cwd(), "docs", "tax-runbook.md"), "utf8")));

  it("names the guide, keeps the intro and numbers the sections", () => {
    expect(guide.title).toBe("Guide fiscal et paiements");
    expect(guide.intro.length).toBeGreaterThan(0);
    expect(guide.sections.map((section) => section.number)).toEqual(guide.sections.map((_, index) => index + 1));
    expect(new Set(guide.sections.map((section) => section.id)).size).toBe(guide.sections.length);
  });

  it("has the sections the Ventes page links to", () => {
    const byId = new Map(guide.sections.map((section) => [section.id, section.title]));
    expect(byId.get(TAX_GUIDE_ANCHORS.franchise)).toMatch(/franchise/i);
    expect(byId.get(TAX_GUIDE_ANCHORS.euB2c)).toMatch(/10 000 EUR/);
    expect(byId.get(TAX_GUIDE_ANCHORS.exports)).toMatch(/exports/i);
    expect(byId.get(TAX_GUIDE_ANCHORS.nightly)).toMatch(/nuit/i);
  });

  it("counts the checklist of the sales opening", () => {
    const opening = guide.sections[0]!;
    expect(opening.tasks?.total).toBeGreaterThan(0);
    expect(opening.tasks!.done).toBeLessThanOrEqual(opening.tasks!.total);
    expect(guide.sections.find((section) => section.id === TAX_GUIDE_ANCHORS.franchise)?.tasks).toBeNull();
  });

  it("gives an unnumbered section a slug and keeps ids unique", () => {
    const parsed = taxGuide(parseMarkdown("# T\n\nIntro.\n\n## Été à Fès\n\nA.\n\n## Été à Fès\n\nB."));
    expect(parsed.sections.map((section) => [section.id, section.number])).toEqual([
      ["ete-a-fes", null],
      ["ete-a-fes-bis", null],
    ]);
  });
});
