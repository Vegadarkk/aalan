"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { lazyIsland } from "@/components/layout/lazy-island";
import { showsAssistantBubble, showsSellButton } from "@/components/layout/shell-paths";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { AssistantPanelProps } from "./assistant-panel";

// The Assistant Aalan on every public page (owner, 2026-10-30: a chat at the bottom right to help
// and guide visitors): a round bubble at the bottom end, the help pages' panel loaded on first use
// and kept mounted so the conversation survives a close. Left out on /aide, which has its own
// launcher (two panels would answer the same hash), on the legal texts and on the focused flows
// (shell-paths.ts). On a phone it stands above the « Vendre » arch, or in the corner where the arch
// is left out; on the search map, above its controls.

const AssistantPanel = lazyIsland<AssistantPanelProps>(() => import("./assistant-panel"), () => null);

/**
 * `from`: the site's opening (ISO) while it is closed (its API answers 503 until then): no bubble
 * before it. The page may be served from cache past the opening, so the browser checks the time
 * after hydration (the server rendered no bubble: same first render).
 */
export function AssistantBubble({ from = null }: { from?: string | null }) {
  const t = useTranslations("Help.assistant");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [opened, setOpened] = useState(from === null);
  const bubble = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (from === null) return;
    // At once past the opening (a page served from cache), else for a tab left open across it
    // (setTimeout holds at most about 24.8 days).
    const wait = Math.max(0, Date.parse(from) - Date.now());
    if (wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => setOpened(true), wait);
    return () => clearTimeout(timer);
  }, [from]);
  if (!opened || !showsAssistantBubble(pathname)) return null;
  // Above the « Vendre » arch on a phone, or in the corner where the arch is left out.
  const aboveSell = showsSellButton(pathname);
  return (
    <>
      <button
        ref={bubble}
        type="button"
        data-testid="assistant-bubble"
        aria-label={t("open")}
        title={t("open")}
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        onPointerEnter={() => setLoaded(true)}
        className={cn(
          // 48 px on a phone (audit zone 1 Z1-07: the 56 px bubble hid the end of fields and cards).
          "fixed end-4 z-30 flex size-12 items-center justify-center rounded-full bg-structure text-structure-foreground shadow-lg shadow-bab-950/20 ring-2 ring-featured/70 md:size-14",
          "transition-[scale,background-color] duration-150 ease-door hover:scale-105 active:scale-95",
          aboveSell ? "bottom-[max(5.25rem,calc(env(safe-area-inset-bottom)+4.75rem))]" : "bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]",
          "md:bottom-5",
          "[:root:has([data-testid=consent-banner])_&]:hidden [:root:has(main_:is(input,select,textarea):focus)_&]:max-md:hidden",
          // The search map: above the phone sheet's « Vendre » arch, above the zoom buttons on a desktop.
          "search-map:bottom-[calc(var(--search-sheet,0px)+5rem)] search-map:md:bottom-36 [:root[data-search-snap=full]_&]:search-map:max-md:hidden",
        )}
      >
        <MessageCircleQuestion className="size-5 md:size-6" aria-hidden="true" />
      </button>
      {loaded ? (
        <Suspense fallback={null}>
          <AssistantPanel open={open} onOpenChange={setOpen} returnFocus={() => bubble.current} />
        </Suspense>
      ) : null}
    </>
  );
}
