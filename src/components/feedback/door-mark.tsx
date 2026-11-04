import { ARCH, DOORWAY, FILLET, FRAME, PANEL, STAR, STAR_CORE, THRESHOLD } from "@/lib/brand/door";
import { cn } from "@/lib/utils";

/**
 * The door of the logo (public/brand/aalan-icon.svg geometry): horseshoe pointed arch with its gold
 * fillet, khoukha with a gilded panel, eight-point door star and gold pedestal. Used for empty
 * states and brand moments instead of stock illustrations.
 */
export function DoorMark({ className }: { className?: string }) {
  return (
    <svg viewBox="136 56 240 386" className={cn("h-auto w-24", className)} aria-hidden="true" focusable="false">
      <path className="fill-bab-700 dark:fill-bab-500" d={ARCH} />
      <path className="fill-gold-400" d={FILLET} />
      <path className="fill-cream-200" d={FRAME} />
      <path className="fill-ochre-500" d={DOORWAY} />
      <path className="fill-gold-400" fillRule="evenodd" d={PANEL} />
      <path className="fill-gold-400" d={THRESHOLD} />
      <path className="fill-gold-400" d={STAR} />
      <path className="fill-cream-200" d={STAR_CORE} />
    </svg>
  );
}
