import { Check } from "lucide-react";
import type { ReactNode } from "react";
import type { Inline, MdBlock, MdList } from "@/lib/legal/markdown";
import { cn } from "@/lib/utils";
import { linkClassName } from "./panel";

// Markdown of a back-office guide (the tax guide, zone 7 P3-7), parsed by src/lib/legal/markdown.ts
// and rendered as React (never HTML strings): nested lists, and checklists whose ticked items read
// as done ("Fait") and the others as still to do ("À faire").

function InlineView({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        // French typography: no line break before « : ; ! ? », after «, or inside "10 000".
        return node.value
          .replace(/ ([:;!?»])/g, " $1")
          .replace(/« /g, "« ")
          .replace(/(\d) (?=\d{3}\b)/g, "$1 ");
      case "strong":
        return (
          <strong key={index} className="font-semibold text-foreground">
            <InlineView nodes={node.children} />
          </strong>
        );
      case "em":
        return (
          <em key={index}>
            <InlineView nodes={node.children} />
          </em>
        );
      case "code":
        return (
          <code key={index} dir="ltr" className="rounded-sm bg-surface-muted px-1 py-0.5 font-mono text-[0.875em] break-words text-foreground">
            {node.value}
          </code>
        );
      case "link": {
        const external = node.href.startsWith("https://");
        return (
          <a key={index} href={node.href} className={linkClassName} {...(external ? { target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" as const } : {})}>
            <InlineView nodes={node.children} />
          </a>
        );
      }
    }
  });
}

function ListView({ list, depth = 0 }: { list: MdList; depth?: number }) {
  const tasks = list.checked !== undefined;
  const items = list.items.map((item, index) => {
    const checked = list.checked?.[index] ?? null;
    const sub = list.nested?.[index];
    return (
      <li key={index} className={cn(checked !== null && "flex gap-3")}>
        {checked === null ? null : (
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
              checked ? "bg-success-surface text-success ring-1 ring-success/30" : "ring-1 ring-border-strong ring-inset",
            )}
          >
            {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {checked === null ? null : <span className="sr-only">{checked ? "Fait : " : "À faire : "}</span>}
          <span className={cn(checked === true && "text-foreground-muted")}>
            <InlineView nodes={item} />
          </span>
          {sub ? <ListView list={sub} depth={depth + 1} /> : null}
        </div>
      </li>
    );
  });
  if (list.ordered) {
    return (
      <ol start={list.start} className="mt-1.5 flex list-decimal flex-col gap-1.5 ps-6 marker:text-foreground-muted">
        {items}
      </ol>
    );
  }
  return (
    <ul
      className={cn(
        "flex flex-col",
        tasks ? "gap-3" : depth === 0 ? "list-disc gap-1.5 ps-5 marker:text-featured" : "list-[circle] gap-1 ps-5 marker:text-foreground-muted",
        depth > 0 && "mt-1.5",
      )}
    >
      {items}
    </ul>
  );
}

export function GuideBlocks({ blocks }: { blocks: readonly MdBlock[] }) {
  return blocks.map((block, index) => {
    switch (block.type) {
      case "heading":
        return (
          <h3 key={index} className="pt-2 font-semibold text-balance">
            <InlineView nodes={block.children} />
          </h3>
        );
      case "paragraph":
        return (
          <p key={index} className="text-pretty">
            <InlineView nodes={block.children} />
          </p>
        );
      case "list":
        return <ListView key={index} list={block} />;
      case "table":
        return (
          <div key={index} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-strong">
                  {block.head.map((cell, cellIndex) => (
                    <th key={cellIndex} scope="col" className="px-3 py-2 text-start font-semibold first:ps-0">
                      <InlineView nodes={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2 align-top first:ps-0">
                        <InlineView nodes={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "rule":
        return <hr key={index} className="border-border" />;
    }
  });
}
