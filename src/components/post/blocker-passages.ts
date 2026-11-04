"use client";

import { useEffect, useState } from "react";
import type { FieldIssue, OwnerListing } from "@/lib/contracts/listings";

// Quoting the passage a server blocker is about (zone 3 P2-9): the detectors are loaded on demand,
// only when such a blocker is on screen.

type Finder = (code: string, text: string) => string[];

const PASSAGE_CODES: ReadonlySet<string> = new Set(["phone_in_text", "email_in_text", "url_in_text"]);

export const isPassageIssue = (issue: Pick<FieldIssue, "code">) => PASSAGE_CODES.has(issue.code);

/** The free text a blocker path points at ("" when the path is not a text the wizard holds). */
export function textAtPath(listing: OwnerListing, path: string): string {
  if (path === "title") return listing.title;
  if (path === "description") return listing.description;
  if (path === "location.district") return listing.location?.district ?? "";
  if (path.startsWith("attributes.")) {
    const value = listing.attributes[path.slice("attributes.".length)];
    return typeof value === "string" ? value : "";
  }
  return "";
}

/** The passage finder once loaded (null before, or when `needed` is false). */
export function usePassageFinder(needed: boolean): Finder | null {
  const [finder, setFinder] = useState<Finder | null>(null);
  useEffect(() => {
    if (!needed || finder) return;
    let live = true;
    void import("@/lib/moderation/passages").then(
      (module) => {
        if (live) setFinder(() => module.blockerPassages);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [needed, finder]);
  return needed ? finder : null;
}
