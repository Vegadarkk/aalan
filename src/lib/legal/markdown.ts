// The Markdown subset of the legal pages (phase 6, D11), parsed into a tree that React renders
// (never HTML strings): headings with `{#id}` anchors, paragraphs, bullet and numbered lists,
// pipe tables, **bold**, *italic*, `code`, [links](href), bare https URLs and e-mail addresses.
// Lists nest by indentation and carry task items ("- [ ]", "- [x]"), which the back-office guides
// use (the legal sources have neither). Client-safe and pure. Only same-site paths, anchors, https
// and mailto links survive.

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong" | "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export interface MdList {
  type: "list";
  ordered: boolean;
  start: number;
  items: Inline[][];
  /** The indented list under each item, when one has any. */
  nested?: (MdList | null)[];
  /** Task state of each item ("- [x]" true, "- [ ]" false, a plain item null), when one is a task. */
  checked?: (boolean | null)[];
}

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; id: string | null; children: Inline[]; text: string }
  | { type: "paragraph"; children: Inline[] }
  | MdList
  | { type: "table"; head: Inline[][]; rows: Inline[][][] }
  | { type: "rule" };

const HEADING = /^(#{1,4})\s+(.*?)(?:\s+\{#([\w-]+)\})?\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.*)$/;
const ITEM = /^(\s*)(?:([-*])|(\d+)[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const RULE = /^(?:-{3,}|\*{3,})\s*$/;

/** A link target the page may carry; anything else is rendered as plain text. */
export function safeHref(href: string): string | null {
  // "/\host" is read as "//host" by browsers: a protocol-relative URL, never a same-site path.
  if (/^\/(?![/\\])/.test(href) || href.startsWith("#")) return href;
  if (/^https:\/\/[^\s]+$/.test(href) || /^mailto:[^\s@]+@[^\s@]+$/.test(href)) return href;
  return null;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

// Bidi isolates (U+2066-U+2069, around the values of an Arabic text) end a URL.
const AUTOLINK = /(https:\/\/[^\s<>()\u2066-\u2069]+[^\s<>().,;:!?»"')\u2066-\u2069]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function autolink(value: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of value.matchAll(AUTOLINK)) {
    if (match.index > last) out.push({ type: "text", value: value.slice(last, match.index) });
    const target = match[0];
    out.push({ type: "link", href: target.includes("@") && !target.startsWith("https://") ? `mailto:${target}` : target, children: [{ type: "text", value: target }] });
    last = match.index + target.length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/** Characters a backslash makes literal (the template escapes them in config values). */
const ESCAPABLE = /[\\`*_[\](){}#|]/;

/**
 * Inline syntax: code, links, bold, italic, backslash escapes; the rest is text, with bare URLs and
 * e-mails linked except inside a link (`autolinks` false: no link in a link).
 */
export function parseInline(source: string, autolinks = true): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(...(autolinks ? autolink(text) : [{ type: "text" as const, value: text }]));
    text = "";
  };
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    let match: RegExpExecArray | null;
    if (source[index] === "\\" && ESCAPABLE.test(source[index + 1] ?? "")) {
      text += source[index + 1];
      index += 2;
      continue;
    }
    if ((match = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ type: "code", value: match[1]! });
    } else if ((match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      const href = safeHref(match[2]!);
      const children = parseInline(match[1]!, false);
      if (href) out.push({ type: "link", href, children });
      else out.push(...children);
    } else if ((match = /^\*\*(.+?)\*\*/.exec(rest))) {
      flush();
      out.push({ type: "strong", children: parseInline(match[1]!, autolinks) });
    } else if ((match = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
      flush();
      out.push({ type: "em", children: parseInline(match[1]!, autolinks) });
    } else {
      text += source[index];
      index += 1;
      continue;
    }
    index += match[0].length;
  }
  flush();
  return out;
}

/** Plain text of inline nodes (table of contents, tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((node) => ("children" in node ? inlineText(node.children) : node.value)).join("");
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * The list starting at `lines[start]` (an item at `indent`): items of the same kind at that indent,
 * deeper items as the list under the previous item, deeper text lines as its continuation. Ends at
 * a blank line, a shallower line, or an item of the other kind.
 */
function readList(lines: string[], start: number, indent: number): { block: MdList; next: number } {
  const first = ITEM.exec(lines[start]!)!;
  const ordered = first[2] === undefined;
  const texts: string[] = [];
  const nested: (MdList | null)[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) break;
    const depth = indentOf(line);
    const item = ITEM.exec(line);
    if (item && depth === indent) {
      if ((item[2] === undefined) !== ordered) break;
      texts.push(item[4]!);
      nested.push(null);
      index += 1;
    } else if (item && depth > indent && texts.length > 0) {
      const sub = readList(lines, index, depth);
      const last = nested.length - 1;
      const previous = nested[last];
      nested[last] = previous ? { ...previous, items: [...previous.items, ...sub.block.items] } : sub.block;
      index = sub.next;
    } else if (depth > indent && texts.length > 0) {
      texts[texts.length - 1] += ` ${line.trim()}`;
      index += 1;
    } else break;
  }
  const tasks = texts.map((text) => (ordered ? null : TASK.exec(text)));
  const block: MdList = {
    type: "list",
    ordered,
    start: ordered ? Number(first[3]) : 1,
    items: texts.map((text, at) => parseInline(tasks[at] ? tasks[at][2]! : text)),
  };
  if (nested.some(Boolean)) block.nested = nested;
  if (tasks.some(Boolean)) block.checked = tasks.map((task) => (task ? task[1] !== " " : null));
  return { block, next: index };
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let index = 0;
  const isBlockStart = (line: string, next: string | undefined) =>
    HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line) || RULE.test(line) || (line.trim().startsWith("|") && next !== undefined && TABLE_SEPARATOR.test(next));

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const children = parseInline(heading[2]!);
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4, id: heading[3] ?? null, children, text: inlineText(children) });
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (line.trim().startsWith("|") && lines[index + 1] !== undefined && TABLE_SEPARATOR.test(lines[index + 1]!)) {
      const head = splitRow(line).map((cell) => parseInline(cell));
      const rows: Inline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        rows.push(splitRow(lines[index]!).map((cell) => parseInline(cell)));
        index += 1;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const list = readList(lines, index, 0);
      blocks.push(list.block);
      index = list.next;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !(paragraph.length > 0 && isBlockStart(lines[index]!, lines[index + 1]))) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }
  return blocks;
}
