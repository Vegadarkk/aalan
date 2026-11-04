"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

// The address of the page, on paper only (audit zone 8, impression 3): a printed CGU or listing
// says where it comes from. The host is the one the visitor reads (staging, production), never a
// built-in origin; the server render shows the path until the page hydrates.

const noSubscription = () => () => {};

interface PrintSourceProps {
  /** "Adresse de la page :" in the page's language. */
  label: string;
  /** The page's path, e.g. /fr/legal/cgu (the search and the hash are left out). */
  path: string;
  className?: string;
}

export function PrintSource({ label, path, className }: PrintSourceProps) {
  const href = useSyncExternalStore(noSubscription, () => `${window.location.origin}${path}`, () => path);
  return (
    <p className={cn("hidden text-sm print:block", className)}>
      {label} <span dir="ltr">{href}</span>
    </p>
  );
}
