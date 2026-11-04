import "server-only";
import { requireOwner, requireUser } from "@/lib/auth/guards";
import { listingIdSchema } from "@/lib/contracts/listings";
import { PHOTO_VARIANTS, uploadIdSchema } from "@/lib/contracts/media";
import { getListing } from "@/lib/db/repositories/listings";
import { notFound } from "@/lib/http/errors";
import { MEDIA_CONTENT_TYPE } from "@/lib/media/urls";
import { readStoredPhoto, type StoredPhotoTarget } from "@/lib/media/stored-photo";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { isStorageNotConfigured, objectStore, type ObjectStore } from "@/lib/storage";

// GET /api/owner-media/listings/{listingId}/{photoId}-{variant}.webp (audit C-3): a photo of the
// seller's own refused, removed or hidden listing, whose variants left the media host for the
// private bucket (uploads/policy.ts photosArePrivate), so the wizard and « Mes annonces » still
// show them (OWNER_MEDIA_BASE: same paths as the media host). Owner (or shop member) only, a
// listing of someone else answers 404; read from the private bucket, then the media bucket (a move
// not done yet). Each image costs one listing read, charged to listing.owner.read.uid. Cached by the
// owner's browser only (`private`: never by Cloudflare or another shared cache).

export const OWNER_PHOTO_CACHE_CONTROL = "private, max-age=600";

const FILE_PATTERN = /^([^/]+)-([a-z])\.webp$/;

/** The route's segments, validated (ids by their schemas, a known variant), or null. */
export function parseOwnerPhotoParams(params: Record<string, string | string[] | undefined>): StoredPhotoTarget | null {
  const listingId = listingIdSchema.safeParse(params["id"]);
  const file = typeof params["file"] === "string" ? FILE_PATTERN.exec(params["file"]) : null;
  if (!listingId.success || !file) return null;
  const photoId = uploadIdSchema.safeParse(file[1]);
  const variant = PHOTO_VARIANTS.find((name) => name === file[2]);
  if (!photoId.success || !variant) return null;
  return { listingId: listingId.data, photoId: photoId.data, variant };
}

function store(): ObjectStore {
  try {
    return objectStore();
  } catch (error) {
    if (isStorageNotConfigured(error)) throw notFound();
    throw error;
  }
}

export async function handleOwnerPhoto(request: Request, params: Promise<Record<string, string | string[] | undefined>>): Promise<Response> {
  // A suspended account still reads its own listings (handleMine).
  const auth = await requireUser(request, { allowSuspended: true });
  const target = parseOwnerPhotoParams(await params);
  if (!target) throw notFound();
  await enforceLimit("listing.owner.read.uid", auth.user.uid);
  const listing = await getListing(target.listingId);
  if (!listing) throw notFound();
  requireOwner(auth, listing);
  const body = await readStoredPhoto(store(), target);
  if (!body) throw notFound();
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": MEDIA_CONTENT_TYPE,
      "Content-Length": String(body.byteLength),
      "Cache-Control": OWNER_PHOTO_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
