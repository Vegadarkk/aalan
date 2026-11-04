"use client";

import { useEffect } from "react";

// Unread count in the tab title (audit §7): « (3) Messages - Aalan », as webmail does, so a
// background tab shows new messages. The pages set their own titles on every navigation: the
// prefix is put back whenever the <title> changes, and taken off when nothing is unread. Only the
// prefix this hook wrote is ever removed (a listing titled « (2) Chaises » keeps its own).

/** The prefix written last (one per tab: every mounted badge writes the same one). */
let written: string | null = null;

/** The title with the count in front (none at 0), after removing the `previous` prefix if it leads. */
export function titleWithUnread(title: string, unread: number, previous: string | null): { title: string; prefix: string | null } {
  const base = previous && title.startsWith(previous) ? title.slice(previous.length) : title;
  if (unread <= 0) return { title: base, prefix: null };
  const prefix = `(${unread > 99 ? "99+" : unread}) `;
  return { title: prefix + base, prefix };
}

function write(unread: number): void {
  const next = titleWithUnread(document.title, unread, written);
  written = next.prefix;
  if (next.title !== document.title) document.title = next.title;
}

export function useUnreadTitle(unread: number | null): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const total = unread ?? 0;
    write(total);
    // A navigation replaces the <title> (or its text): the count goes back in front.
    const observer = new MutationObserver(() => {
      if (total > 0 && written && document.title.startsWith(written)) return;
      write(total);
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      write(0);
    };
  }, [unread]);
}
