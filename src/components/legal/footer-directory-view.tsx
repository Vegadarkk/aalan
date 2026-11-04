"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Locale } from "@/config/site";
import { cn } from "@/lib/utils";

// The footer's directory (the plan of the categories and of the regions with their main cities):
// about 150 links that were in the HTML and again in the RSC payload of every page (audit zone 8,
// perf 6). The page now carries the category landing pages only (/c/..., the crawlable entry
// points); the subcategory and place searches (robots.txt disallows /recherche) come from
// /api/footer-directory/<locale>, a static JSON the browser caches, once the band is about to show:
// near the viewport from md, where it is always open, or when a phone opens the fold.

export interface DirectoryLink {
  label: string;
  href: string;
}

export interface DirectorySection extends DirectoryLink {
  links: DirectoryLink[];
}

export interface FooterDirectoryData {
  categories: DirectorySection[];
  regions: DirectorySection[];
}

/** The static JSON of a locale's directory (src/app/api/footer-directory/[locale]/route.ts). */
export const footerDirectoryUrl = (locale: Locale) => `/api/footer-directory/${locale}`;

/** From md the fold is open (fold-open-md in globals.css) and loads when it nears the viewport. */
const WIDE = "(min-width: 48rem)";

// The band sits on the structure green: lighter links, underlined like a plan of the site. Set once
// on each <nav> for the links inside, not on each of its ~150 links.
const navClass =
  "columns-2 gap-8 sm:columns-3 lg:columns-4 [&_a]:text-structure-foreground/80 [&_a]:underline [&_a]:decoration-structure-foreground/30 [&_a]:underline-offset-2 [&_a:hover]:text-structure-foreground [&_a:hover]:decoration-current";

function Sections({ sections }: { sections: readonly DirectorySection[] }) {
  return sections.map((section) => (
    <div key={section.href} className="mb-7 break-inside-avoid">
      <p className="mb-2 text-sm font-semibold tracking-wide uppercase">
        <a href={section.href}>{section.label}</a>
      </p>
      {section.links.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {section.links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  ));
}

interface FooterDirectoryProps {
  locale: Locale;
  /** The categories with their landing page, rendered on the server (no subcategories). */
  heads: readonly DirectoryLink[];
  labels: { toggle: string; categories: string; regions: string };
}

export function FooterDirectory({ locale, heads, labels }: FooterDirectoryProps) {
  const fold = useRef<HTMLDetailsElement>(null);
  const [loaded, setLoaded] = useState<{ locale: Locale; data: FooterDirectoryData } | null>(null);
  const data = loaded?.locale === locale ? loaded.data : null;
  const requested = useRef<Locale | null>(null);

  const load = useCallback(() => {
    if (requested.current === locale) return;
    requested.current = locale;
    fetch(footerDirectoryUrl(locale))
      .then((response) => (response.ok ? (response.json() as Promise<FooterDirectoryData>) : Promise.reject(new Error(String(response.status)))))
      .then((next) => setLoaded({ locale, data: next }))
      // The category heads stay; the next opening (or the next page) asks again.
      .catch(() => {
        if (requested.current === locale) requested.current = null;
      });
  }, [locale]);

  useEffect(() => {
    const element = fold.current;
    if (!element || data) return;
    if (element.open) load();
    const wide = window.matchMedia(WIDE);
    const observer = new IntersectionObserver((entries) => {
      if (wide.matches && entries.some((entry) => entry.isIntersecting)) load();
    }, { rootMargin: "800px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [load, data]);

  const busy = !data;
  return (
    <details ref={fold} className="group fold-open-md" onToggle={(event) => event.currentTarget.open && load()}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-structure-foreground/25 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {labels.toggle}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-8 pt-6 md:pt-0">
        <nav aria-label={labels.categories} aria-busy={busy || undefined} className={navClass}>
          <Sections sections={data?.categories ?? heads.map((head) => ({ ...head, links: [] }))} />
        </nav>
        {data ? (
          <nav aria-label={labels.regions} className={cn(navClass, "border-t border-structure-foreground/15 pt-8")}>
            <Sections sections={data.regions} />
          </nav>
        ) : null}
      </div>
    </details>
  );
}
