import "server-only";
import { shopNamesByPublicId } from "@/lib/pro/directory";
import type { CardDocument } from "./types";

// The shop's name on the cards of Pro listings (UX audit of the Pro shops, lot 2): the index has
// the seller's publicId, the directory's shared copy has the shops. Looked up only when a hit is a
// Pro's; nothing is read for a page of members' listings.

export async function shopNamesFor(docs: readonly Pick<CardDocument, "sellerType" | "sellerPublicId">[]): Promise<(doc: Pick<CardDocument, "sellerType" | "sellerPublicId">) => string | undefined> {
  if (!docs.some((doc) => doc.sellerType === "pro")) return () => undefined;
  const names = await shopNamesByPublicId();
  return (doc) => (doc.sellerType === "pro" && doc.sellerPublicId ? names.get(doc.sellerPublicId) : undefined);
}
