"use client";

import { useEffect, useState, type ComponentType } from "react";
import { useSession } from "@/lib/auth/client";
import type { TourId } from "@/lib/tours/catalog";
import { acquireTourSlot, markTourSeen, tourShouldStart } from "@/lib/tours/client";
import type { TourOutcome, TourOverlayProps } from "./tour-overlay";

// Placed on a screen beside the elements its tour points at: decides whether the tour starts
// (src/lib/tours/client.ts) and only then loads the overlay, so a tour already seen costs this
// component alone.

export function GuidedTour({ id }: { id: TourId }) {
  const { status, session } = useSession();
  const signedIn = Boolean(session);
  const [running, setRunning] = useState<{ Overlay: ComponentType<TourOverlayProps>; release: () => void } | null>(null);

  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    let release: (() => void) | null = null;
    void (async () => {
      if (!(await tourShouldStart(id, signedIn)) || !live) return;
      const freed = await acquireTourSlot();
      if (!live) return freed();
      // Another tour may have run meanwhile and the settings changed: ask again.
      if (!(await tourShouldStart(id, signedIn)) || !live) return freed();
      try {
        const { TourOverlay } = await import("./tour-overlay");
        if (!live) return freed();
        release = freed;
        setRunning({ Overlay: TourOverlay, release: freed });
      } catch {
        freed();
      }
    })();
    return () => {
      live = false;
      release?.();
    };
  }, [id, signedIn, status]);

  if (!running) return null;
  const { Overlay } = running;
  return (
    <Overlay
      tour={id}
      onClose={(outcome: TourOutcome) => {
        if (outcome !== "empty") markTourSeen(id, signedIn);
        running.release();
        setRunning(null);
      }}
    />
  );
}
