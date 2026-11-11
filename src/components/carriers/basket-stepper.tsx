"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CARRIER_ITEM_IDS, CARRIER_SEARCH, type CarrierItem } from "@/config/carriers";

// The basket's item list and stepper, shared by the search of /transporteurs and the place
// request's basket (basket.tsx). No messages of its own: the labels come from the caller.

/** Items offered first; the rest of the catalogue opens below. */
export const FIRST_ITEMS = ["suitcase", "box-m", "big-bag", "e-scooter", "bicycle", "tv-large"] as const satisfies readonly CarrierItem[];
export const MORE_ITEMS = CARRIER_ITEM_IDS.filter((item) => !(FIRST_ITEMS as readonly string[]).includes(item));

export function Stepper({ item, value, onChange, less, more }: { item: string; value: number; onChange: (value: number) => void; less: string; more: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={item}>
      <Button type="button" variant="outline" size="icon" aria-label={less} disabled={value <= 0} onClick={() => onChange(value - 1)} className="size-10">
        <Minus aria-hidden="true" className="size-4" />
      </Button>
      <output aria-live="polite" className="w-8 text-center font-semibold tabular-nums">
        {value}
      </output>
      <Button type="button" variant="outline" size="icon" aria-label={more} disabled={value >= CARRIER_SEARCH.itemMax} onClick={() => onChange(value + 1)} className="size-10">
        <Plus aria-hidden="true" className="size-4" />
      </Button>
    </span>
  );
}
