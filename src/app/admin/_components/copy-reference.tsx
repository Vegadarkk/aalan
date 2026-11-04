"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A stored reference (listing id, profile id), secondary to the readable title, copied in one
 * click for a message to a colleague or a search (zone 7 audit P2-8). The text stays selectable
 * when the clipboard is blocked.
 */
export function CopyReference({ value, label = "Référence", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Blocked clipboard: the reference stays selectable on screen.
    }
  }

  if (!value) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs text-foreground-muted", className)}>
      <span className="shrink-0">{label}</span>
      <span dir="ltr" className="truncate font-mono tabular-nums select-all">
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copiée` : `Copier la référence ${value}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        {copied ? <Check aria-hidden="true" className="size-3.5 text-success" /> : <Copy aria-hidden="true" className="size-3.5" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copié" : ""}
      </span>
    </span>
  );
}
