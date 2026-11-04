"use client";

import { useEffect } from "react";

/** Sets the tab's title where a segment cannot export metadata (a nested not-found). */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}
