"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { showsAssistantBubble, showsSellButton } from "./shell-paths";

// The buttons that float over the page (the « Vendre » arch on a phone, the Assistant bubble) in a
// landmark of their own: outside one, a screen reader's landmark list skips them (axe `region`,
// audit zone 8, 5.2-7). Left out where neither shows, so no empty landmark is announced. It cannot
// sit in the header: its backdrop filter would become the containing block of `position: fixed`.

export function FloatingActions({ label, children }: { label: string; children: ReactNode }) {
  const pathname = usePathname();
  if (!showsSellButton(pathname) && !showsAssistantBubble(pathname)) return null;
  return <aside aria-label={label}>{children}</aside>;
}
