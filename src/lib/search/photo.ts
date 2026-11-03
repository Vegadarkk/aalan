import { PHOTO_VARIANTS, type PhotoVariant } from "@/lib/contracts/photo-variants";
import type { SearchPhoto } from "./types";

// The cover photo as an index document holds it, copied field by field (a document read back from
// the engine is not trusted to have only these). `variants` lets the cards pick the `m` variant
// for a portrait photo instead of the large one (audit zone 8 P0, B15); documents indexed before it
// have none and fall back to the legacy `s` + `l` pair.

export function searchPhotoOf(photo: { id: string; w: number; h: number; blurhash: string; variants?: readonly unknown[] } | undefined | null): SearchPhoto | null {
  if (!photo) return null;
  const variants = Array.isArray(photo.variants) ? photo.variants.filter((variant): variant is PhotoVariant => (PHOTO_VARIANTS as readonly unknown[]).includes(variant)) : [];
  return { id: photo.id, w: photo.w, h: photo.h, blurhash: photo.blurhash, ...(variants.length > 0 ? { variants: [...new Set(variants)] } : {}) };
}
