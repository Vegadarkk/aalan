import type { MdBlock, MdList } from "@/lib/legal/markdown";

// The team's tax guide (docs/tax-runbook.md) as the back office shows it (zone 7 audit P3-7):
// Guide démarches > Guide fiscal, admins only. The Markdown in the repo stays the one source; this
// splits it into its numbered sections, each with a stable anchor (`section-4`) the Ventes page
// links to, and counts the boxes ticked in each checklist. Pure: the page reads the file.

export interface TaxGuideSection {
  /** `section-{n}` for "## n. Title", else a slug of the title. */
  id: string;
  /** The section's number when the title has one. */
  number: number | null;
  /** The title without its number. */
  title: string;
  blocks: MdBlock[];
  /** Task items of the section's checklists: how many, how many done (null: no checklist). */
  tasks: { done: number; total: number } | null;
}

export interface TaxGuide {
  title: string;
  /** What comes before the first section. */
  intro: MdBlock[];
  sections: TaxGuideSection[];
}

/** Anchors of the sections the Ventes page links to. */
export const TAX_GUIDE_ANCHORS = { franchise: "section-4", euB2c: "section-5", exports: "section-8", nightly: "section-9" } as const;

export const TAX_GUIDE_PATH = "/guide/fiscal";

function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

/** Ticked and total task items of a list and the lists under it. */
export function countTasks(list: MdList): { done: number; total: number } {
  let done = 0;
  let total = 0;
  list.checked?.forEach((checked) => {
    if (checked === null) return;
    total += 1;
    if (checked) done += 1;
  });
  for (const sub of list.nested ?? []) {
    if (!sub) continue;
    const counted = countTasks(sub);
    done += counted.done;
    total += counted.total;
  }
  return { done, total };
}

export function taxGuide(blocks: readonly MdBlock[]): TaxGuide {
  let title = "Guide fiscal";
  const intro: MdBlock[] = [];
  const sections: TaxGuideSection[] = [];
  const used = new Set<string>();
  for (const block of blocks) {
    if (block.type === "heading" && block.level === 1) {
      title = block.text;
      continue;
    }
    if (block.type === "heading" && block.level === 2) {
      const match = /^(\d+)\.\s+(.*)$/.exec(block.text);
      const number = match ? Number(match[1]) : null;
      let id = number !== null ? `section-${number}` : slug(block.text);
      while (used.has(id)) id = `${id}-bis`;
      used.add(id);
      sections.push({ id, number, title: match ? match[2]! : block.text, blocks: [], tasks: null });
      continue;
    }
    const section = sections.at(-1);
    if (!section) {
      intro.push(block);
      continue;
    }
    section.blocks.push(block);
    if (block.type === "list") {
      const counted = countTasks(block);
      if (counted.total > 0) section.tasks = { done: (section.tasks?.done ?? 0) + counted.done, total: (section.tasks?.total ?? 0) + counted.total };
    }
  }
  return { title, intro, sections };
}
