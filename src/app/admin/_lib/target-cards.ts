import "server-only";
import { photoSources } from "@/components/listing/photo";
import { cityBySlug, cityName } from "@/config/regions";
import type { ListingSummary, TargetSummary } from "@/lib/reports/summaries";
import { mediaBaseUrl } from "@/lib/storage/keys";
import { formatPrice } from "../_components/moderation-labels";
import { ACCOUNT_STATUS_LABEL, TARGET_LABEL } from "./moderation-format";
import { staffPhotoSources, usesStaffPhotos } from "./staff-photos";

// The line a back-office queue shows for a target (zone 7 audit P2-8): what it is in words (title,
// seller, price, city; an account's name and state), the first photo, and the stored reference as
// secondary, copyable text. Built on the server and handed to the client queues as plain data.

export interface TargetCard {
  /** "Annonce", "Message", "Compte"... */
  kind: string;
  title: string;
  /** Seller, price and city of a listing; the account's state; where a message was sent. */
  details: string[];
  thumb: { src: string; width: number; height: number } | null;
  /** Stored reference, shown small and copyable (listing id, public profile id, shop id). */
  reference: string;
}

export const cityLabel = (citySlug: string | null) => {
  const city = citySlug ? cityBySlug(citySlug) : undefined;
  return city ? cityName(city, "fr") : null;
};

/** A listing's first photo, through the staff route once its photos left the public bucket. */
export function listingThumb(listing: Pick<ListingSummary, "id" | "status" | "photo">, base = mediaBaseUrl()): TargetCard["thumb"] {
  if (!listing.photo) return null;
  const sources = usesStaffPhotos(listing.status) ? staffPhotoSources(listing.id, listing.photo, "s") : photoSources(base, listing.id, listing.photo, "s");
  return sources ? { src: sources.src, width: sources.width, height: sources.height } : null;
}

/** Seller, price and city of a listing, the parts it has. */
export function listingDetails(listing: Pick<ListingSummary, "sellerName" | "price" | "isDonation" | "citySlug">): string[] {
  return [listing.sellerName, formatPrice(listing.price, listing.isDonation), cityLabel(listing.citySlug)].filter((part): part is string => Boolean(part));
}

/**
 * The card of a target key, from its summary; falls back to the stored reference when the target
 * is gone (a deleted listing, a closed account) or its read failed.
 */
export function targetCard(target: { type: string; id: string; publicId: string | null; listingId: string | null }, summary: TargetSummary | undefined, base = mediaBaseUrl()): TargetCard {
  const kind = TARGET_LABEL[target.type] ?? target.type;
  const listing = summary?.listing ?? null;
  if (target.type === "listing") {
    if (!listing) return { kind, title: `Annonce ${target.id}`, details: ["Annonce introuvable"], thumb: null, reference: target.id };
    return { kind, title: listing.title || "Sans titre", details: listingDetails(listing), thumb: listingThumb(listing, base), reference: listing.id };
  }
  if (target.type === "user") {
    const account = summary?.account ?? null;
    const reference = account?.publicId ?? target.publicId ?? target.id;
    if (!account) return { kind, title: `Compte ${reference}`, details: [], thumb: null, reference };
    return { kind, title: account.displayName, details: [`Compte ${(ACCOUNT_STATUS_LABEL[account.status] ?? account.status).toLowerCase()}`], thumb: null, reference };
  }
  if (target.type === "pro") {
    const shop = summary?.shop ?? null;
    return { kind, title: shop?.name ?? `Boutique ${target.id}`, details: shop ? [cityLabel(shop.citySlug) ?? shop.citySlug] : [], thumb: null, reference: target.id };
  }
  // A message or a review: the listing of the conversation it belongs to.
  const where = target.type === "message" ? "Conversation de l'annonce" : "Échange sur l'annonce";
  if (!listing) return { kind, title: target.type === "message" ? "Message" : "Avis", details: target.listingId ? [`${where} ${target.listingId}`] : [], thumb: null, reference: target.listingId ?? "" };
  return { kind, title: `${where} « ${listing.title || "Sans titre"} »`, details: listingDetails(listing), thumb: listingThumb(listing, base), reference: listing.id };
}
