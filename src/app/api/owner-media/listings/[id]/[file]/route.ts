import { apiRoute } from "@/lib/http/route";
import { handleOwnerPhoto } from "@/lib/listings/owner-photos";

// GET /api/owner-media/listings/{id}/{photoId}-{variant}.webp: a photo of the owner's refused,
// removed or hidden listing (src/lib/listings/owner-photos.ts, audit C-3).
export const dynamic = "force-dynamic";
export const GET = apiRoute((request, context) => handleOwnerPhoto(request, context.params));
