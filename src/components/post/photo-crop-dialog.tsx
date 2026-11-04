"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Dialog } from "radix-ui";
import { RotateCcw, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MAX_CLIENT_EDGE_PX } from "@/lib/contracts/media";
import { fitWithin } from "@/lib/listings/client/prepare-image";
import { cn } from "@/lib/utils";
import { FULL_CROP, INITIAL_CROP, addTurns, cropPixels, drawTurned, isFullRect, moveRect, resizeRect, rotateRect, turnedSize, type CropCorner, type CropRect, type QuarterTurns } from "./crop-geometry";
import { useReturnFocus } from "@/components/ui/return-focus";

// « Recadrer ou pivoter » of a photo (audit §7: a crooked phone photo stays crooked otherwise), and
// the crop proposed where the local check found a face (CGU §7, privacy policy §4.4: the seller
// keeps the object and leaves the faces out of the frame). The edited copy is drawn from the local
// file when the browser still holds it, otherwise from the published `l` variant (the media bucket
// answers CORS GET for the site's origins), then uploaded like any new photo; the original goes
// once the copy is ready (store cropPhoto). Quarter turns redraw a preview; the copy is drawn once,
// from the original, at the end. Pointer: drag the frame or a corner. Keyboard: arrows move the
// frame, Shift + arrows resize it from its bottom corner.

interface PhotoCropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Image sources in order of preference (local object URL, then the published variant). */
  sources: readonly string[];
  index: number;
  /** "faces": the proposed crop of a photo with a face; "edit": crop or turn any photo, from the whole image. */
  mode?: "faces" | "edit";
  onCropped: (file: File) => void;
}

const KEY_STEP = 0.02;
const CORNERS: readonly CropCorner[] = ["nw", "ne", "sw", "se"];
/** Longest edge of the turned preview (display only). */
const PREVIEW_EDGE = 1600;
/** Longest edge of the edited copy before upload (the upload preparation brings it to MAX_CLIENT_EDGE_PX). */
const COPY_EDGE = MAX_CLIENT_EDGE_PX * 2;

type Drag = { mode: "move" } | { mode: "resize"; corner: CropCorner };

export function PhotoCropDialog({ open, onOpenChange, sources, index, mode = "faces", onCropped }: PhotoCropDialogProps) {
  // No Dialog.Trigger: the focus goes back to the opening button on close (audit zone 8, 5.2-1).
  const returnFocusOnClose = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bab-950/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          onCloseAutoFocus={returnFocusOnClose}
          data-testid="photo-crop-dialog"
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-lg border border-border bg-surface p-5 shadow-xl shadow-bab-950/20 outline-none sm:p-6",
            "sm:inset-x-auto sm:start-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg rtl:sm:translate-x-1/2",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          {/* Mounted with the content: every opening starts from the proposal and the preferred source. */}
          <CropPanel sources={sources} index={index} mode={mode} onCropped={onCropped} onDone={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Loads an image for drawing on a canvas (a published variant needs CORS to keep the canvas readable). */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!src.startsWith("blob:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

/** `image` turned by `turns` on a canvas whose longest edge is at most `maxEdge`. */
function turnedCanvas(image: HTMLImageElement, turns: QuarterTurns, maxEdge: number): HTMLCanvasElement {
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, maxEdge);
  const turned = turnedSize(width, height, turns);
  const canvas = document.createElement("canvas");
  canvas.width = turned.width;
  canvas.height = turned.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  drawTurned(context, image, width, height, turns);
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/jpeg", quality));
}

function CropPanel({ sources, index, mode, onCropped, onDone }: Pick<PhotoCropDialogProps, "sources" | "index" | "onCropped"> & { mode: "faces" | "edit"; onDone: () => void }) {
  const t = useTranslations("Listing.photos.crop");
  const edit = mode === "edit";
  const [rect, setRect] = useState<CropRect>(edit ? FULL_CROP : INITIAL_CROP);
  const [source, setSource] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [turns, setTurns] = useState<QuarterTurns>(0);
  // Preview of the turned photo (an object URL, revoked when replaced or on close).
  const [turnedUrl, setTurnedUrl] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const original = useRef<{ src: string; image: Promise<HTMLImageElement> } | null>(null);
  const drag = useRef<{ kind: Drag; x: number; y: number; start: CropRect } | null>(null);

  const src = sources[source];
  const unavailable = !src;
  const shown = turns === 0 ? src : turnedUrl;

  useEffect(() => () => {
    if (turnedUrl) URL.revokeObjectURL(turnedUrl);
  }, [turnedUrl]);

  /** The source photo itself, loaded once for drawing (turns and the final copy start from it). */
  function originalImage(): Promise<HTMLImageElement> {
    if (!src) return Promise.reject(new Error("no source"));
    if (original.current?.src !== src) original.current = { src, image: loadImage(src) };
    return original.current.image;
  }

  async function rotate(delta: 1 | -1) {
    if (busy) return;
    const next = addTurns(turns, delta);
    setBusy(true);
    setFailed(false);
    try {
      const url = next === 0 ? null : URL.createObjectURL(await canvasBlob(turnedCanvas(await originalImage(), next, PREVIEW_EDGE), 0.9));
      setLoaded(false);
      setTurnedUrl(url);
      setTurns(next);
      setRect((current) => rotateRect(current, delta));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function begin(event: PointerEvent<HTMLElement>, kind: Drag) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, x: event.clientX, y: event.clientY, start: rect };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!current || !box || box.width === 0 || box.height === 0) return;
    const dx = (event.clientX - current.x) / box.width;
    const dy = (event.clientY - current.y) / box.height;
    setRect(current.kind.mode === "move" ? moveRect(current.start, dx, dy) : resizeRect(current.start, current.kind.corner, dx, dy));
  }

  function end() {
    drag.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setRect((current) => (event.shiftKey ? resizeRect(current, "se", move[0], move[1]) : moveRect(current, move[0], move[1])));
  }

  async function confirm() {
    if (!loaded) return;
    // Nothing turned and nothing cut: the photo stays as it is.
    if (turns === 0 && isFullRect(rect)) {
      onDone();
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const whole = turnedCanvas(await originalImage(), turns, COPY_EDGE);
      const { sx, sy, sw, sh } = cropPixels(rect, whole.width, whole.height);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(whole, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await canvasBlob(canvas, 0.92);
      onCropped(new File([blob], `photo-${index}-${edit ? "modifiee" : "recadree"}.jpg`, { type: "image/jpeg" }));
      onDone();
    } catch {
      // A canvas tainted by a source without CORS, or out of memory: the seller can still remove the photo.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <Dialog.Title className="text-lg font-semibold text-balance">{t(edit ? "editTitle" : "title", { index })}</Dialog.Title>
        <Dialog.Description className="text-sm text-foreground-muted text-pretty">{t(edit ? "editDescription" : "description")}</Dialog.Description>
      </div>

      {unavailable ? (
        <ErrorBanner tone="warning" title={t("unavailable")} />
      ) : (
        <div className="flex justify-center rounded-md bg-bab-950/90 p-6">
          {/* The frame has the image's own size: the crop rectangle maps 1:1 to its fractions. The
              darkening is clipped to the image, the handles may stick out over the padding. */}
          <div ref={frame} className="relative max-w-full touch-none select-none" dir="ltr">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={shown}
                ref={image}
                src={shown}
                alt={t("imageAlt", { index })}
                crossOrigin={shown.startsWith("blob:") ? undefined : "anonymous"}
                draggable={false}
                onLoad={() => setLoaded(true)}
                onError={() => {
                  setLoaded(false);
                  if (turns === 0) setSource((current) => current + 1);
                  else setFailed(true);
                }}
                className="block max-h-[40dvh] w-auto max-w-full sm:max-h-[50dvh]"
              />
            ) : null}
            {loaded && !busy ? (
              <>
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div
                    className="absolute shadow-[0_0_0_9999px_rgb(10_14_12/0.6)]"
                    style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
                  />
                </div>
                <div
                  role="group"
                  tabIndex={0}
                  aria-label={t("frameLabel")}
                  aria-describedby="photo-crop-keys"
                  data-testid="photo-crop-frame"
                  onKeyDown={onKeyDown}
                  onPointerDown={(event) => begin(event, { mode: "move" })}
                  onPointerMove={onPointerMove}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className="absolute cursor-move rounded-[2px] outline-2 outline-cream-100 focus-visible:outline-3 focus-visible:outline-featured"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                >
                  {/* Rule of thirds: helps centre the object. */}
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-1/3 w-px bg-cream-100/40" />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-2/3 w-px bg-cream-100/40" />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-cream-100/40" />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-cream-100/40" />
                  {CORNERS.map((corner) => (
                    <span
                      key={corner}
                      aria-hidden="true"
                      data-corner={corner}
                      onPointerDown={(event) => begin(event, { mode: "resize", corner })}
                      onPointerMove={onPointerMove}
                      onPointerUp={end}
                      onPointerCancel={end}
                      className={cn(
                        "absolute flex size-11 items-center justify-center",
                        corner === "nw" && "-top-5.5 -left-5.5 cursor-nwse-resize",
                        corner === "ne" && "-top-5.5 -right-5.5 cursor-nesw-resize",
                        corner === "sw" && "-bottom-5.5 -left-5.5 cursor-nesw-resize",
                        corner === "se" && "-right-5.5 -bottom-5.5 cursor-nwse-resize",
                      )}
                    >
                      <span className="size-4 rounded-full border-2 border-bab-950 bg-cream-100 shadow-sm" />
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <span className={cn("flex items-center justify-center text-cream-100", shown ? "absolute inset-0" : "size-40")}>
                <Spinner className="size-6" />
              </span>
            )}
          </div>
        </div>
      )}
      {edit && !unavailable ? (
        <div role="group" aria-label={t("rotateLabel")} className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" className="max-sm:h-11" disabled={!loaded || busy} onClick={() => void rotate(-1)} data-testid="photo-rotate-left">
            <RotateCcw aria-hidden="true" />
            {t("rotateLeft")}
          </Button>
          <Button type="button" variant="outline" size="sm" className="max-sm:h-11" disabled={!loaded || busy} onClick={() => void rotate(1)} data-testid="photo-rotate-right">
            <RotateCw aria-hidden="true" />
            {t("rotateRight")}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="max-sm:h-11" disabled={!loaded || busy || (turns === 0 && isFullRect(rect))} onClick={() => { setRect(FULL_CROP); if (turns !== 0) { setLoaded(false); setTurnedUrl(null); setTurns(0); } }}>
            {t("reset")}
          </Button>
        </div>
      ) : null}
      <p id="photo-crop-keys" className="text-xs text-foreground-muted max-sm:sr-only">
        {t("keys")}
      </p>
      {failed ? <ErrorBanner title={t("failed")} /> : null}

      {/* On a phone the actions stay at the bottom of the sheet, whatever the photo's height. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 grid grid-cols-2 gap-2 border-t border-border bg-surface px-5 py-3 sm:static sm:mx-0 sm:mb-0 sm:flex sm:justify-end sm:border-0 sm:p-0">
        <Dialog.Close asChild>
          <Button type="button" variant="outline">
            {t("cancel")}
          </Button>
        </Dialog.Close>
        <Button type="button" loading={busy} disabled={!loaded || unavailable} onClick={() => void confirm()} data-testid="photo-crop-confirm">
          {t(edit ? "editConfirm" : "confirm")}
        </Button>
      </div>
    </>
  );
}
