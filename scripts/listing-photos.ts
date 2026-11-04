// Real photos on the staging test listings (payment tests, the test shop): each listing named on the
// command line gets free-licence photos that match its title (Pexels License, the same source as the
// example listings, src/lib/demo/catalog.ts) in place of the ones it has. They go through the member
// photo pipeline: put in quarantine under a new upload of the listing's owner, then processUpload
// (type sniff, sharp re-encode without metadata, local nudity and face checks, WebP variants,
// blurhash, dHash). The listing's photos are swapped in one update, the old uploads deleted (variants,
// document, R2 storage gauge), and the listing re-indexed. Staging only: in production a member's
// photos are theirs, and the example listings take theirs from the seed.
//
// Run in the worker container (Firestore, the buckets, the classifier and the search queue):
//
//   docker compose exec worker node dist/worker/listing-photos.mjs list
//       the listings that are not examples: id, status, photos, title (read only)
//   docker compose exec worker node dist/worker/listing-photos.mjs set <listingId>=<pexelsId>[,<pexelsId>...] ... [--apply]
//       replaces their photos, in that order; dry run without --apply. Sources are recorded in
//       docs/staging-test-photos.md.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PHOTO_VARIANTS, type ListingPhoto } from "@/lib/contracts/media";
import { getListing, updateListing } from "@/lib/db/repositories/listings";
import { createUpload, deleteUploadDocument, newUploadId, UPLOAD_RETENTION_DAYS } from "@/lib/db/repositories/uploads";
import { COLLECTIONS } from "@/lib/db/schemas";
import { pexelsUrl } from "@/lib/demo/data";
import { serverEnv } from "@/lib/env";
import { db, isFirebaseConfigured } from "@/lib/firebase/admin";
import { LISTING_ID_PATTERN } from "@/lib/listings/ids";
import { processUpload } from "@/lib/media/pipeline";
import { mediaObjectKey, quarantineObjectKey } from "@/lib/media/urls";
import { enqueueIndexJobs } from "@/lib/search/queue";
import { objectStore } from "@/lib/storage";
import { storedBytes } from "@/lib/uploads/policy";
import { recordMediaBytes } from "@/lib/uploads/storage-gauge";
import { closeValkey } from "@/lib/valkey/clients";
import { downloadPhoto } from "./seed-demo";

const DAY_MS = 24 * 60 * 60 * 1000;
/** At most this many photos per listing from the command line (a member may have up to 10). */
const MAX_PHOTOS = 10;
const PEXELS_ID = /^\d{1,12}$/;

export type ListingPhotosArgs = { command: "list" } | { command: "set"; plan: Map<string, string[]>; apply: boolean };

export function parseListingPhotosCli(argv: readonly string[]): ListingPhotosArgs {
  const { values, positionals } = parseArgs({ args: [...argv], options: { apply: { type: "boolean", default: false } }, allowPositionals: true, strict: true });
  const [command, ...pairs] = positionals;
  if (command === "list" && pairs.length === 0 && !values.apply) return { command: "list" };
  if (command !== "set" || pairs.length === 0) throw new Error("usage: listing-photos list | listing-photos set <listingId>=<pexelsId>[,<pexelsId>...] ... [--apply]");
  const plan = new Map<string, string[]>();
  for (const pair of pairs) {
    const [listingId = "", ids = ""] = pair.split("=", 2);
    if (!LISTING_ID_PATTERN.test(listingId)) throw new Error(`invalid listing id in ${pair}`);
    if (plan.has(listingId)) throw new Error(`listing ${listingId} given twice`);
    const pexelsIds = ids.split(",");
    if (pexelsIds.length > MAX_PHOTOS || pexelsIds.some((id) => !PEXELS_ID.test(id))) throw new Error(`expected 1 to ${MAX_PHOTOS} Pexels ids in ${pair}`);
    plan.set(listingId, pexelsIds);
  }
  const all = [...plan.values()].flat();
  if (new Set(all).size !== all.length) throw new Error("a Pexels photo may serve one listing only");
  return { command: "set", plan, apply: values.apply === true };
}

async function list(): Promise<void> {
  const snapshot = await db().collection(COLLECTIONS.listings).select("title", "status", "example", "photos").get();
  console.log(`${snapshot.size} listings read`);
  for (const doc of snapshot.docs) {
    const data = doc.data() as { title?: string; status?: string; example?: boolean; photos?: unknown[] };
    if (data.example) continue;
    console.log(`${doc.id} ${data.status ?? "?"} photos=${data.photos?.length ?? 0} ${data.title ?? ""}`);
  }
}

/** One photo through the member pipeline; the new photo, or an error naming the reason. */
async function addPhoto(listing: { id: string; ownerUid: string }, pexelsId: string, now: Date): Promise<ListingPhoto> {
  const body = await downloadPhoto(pexelsUrl(pexelsId));
  const id = newUploadId();
  const quarantineKey = quarantineObjectKey(id);
  await objectStore().put("quarantine", quarantineKey, body, { contentType: "image/jpeg" });
  await createUpload(id, {
    ownerUid: listing.ownerUid,
    purpose: "listing",
    targetId: listing.id,
    declaredSize: body.byteLength,
    declaredType: "image/jpeg",
    status: "processing",
    quarantineKey,
    bucket: "media",
    checks: {},
    purgeAt: new Date(now.getTime() + UPLOAD_RETENTION_DAYS * DAY_MS),
    createdAt: now,
    updatedAt: now,
  });
  const result = await processUpload(id);
  if (!result) throw new Error(`Pexels ${pexelsId}: upload gone`);
  if (result.status === "rejected") throw new Error(`Pexels ${pexelsId}: rejected (${result.rejectReason})`);
  if (result.status !== "ready") throw new Error(`Pexels ${pexelsId}: still ${result.status}`);
  if (result.faces) console.log(`  note: Pexels ${pexelsId} shows ${result.faces} face(s)`);
  return result.photo;
}

/** The old photo's variants, then its upload document (its bytes come off the storage gauge). */
async function dropPhoto(listingId: string, photoId: string, now: Date): Promise<void> {
  for (const variant of PHOTO_VARIANTS) await objectStore().delete("media", mediaObjectKey(listingId, photoId, variant));
  const freed = storedBytes(await deleteUploadDocument(photoId));
  if (freed > 0) await recordMediaBytes(-freed, now);
}

async function replace(listingId: string, pexelsIds: readonly string[], now: Date): Promise<void> {
  const listing = await getListing(listingId);
  if (!listing) throw new Error(`listing ${listingId} not found`);
  if (listing.example) throw new Error(`listing ${listingId} is an example: its photos come from the seed`);
  const photos: ListingPhoto[] = [];
  for (const pexelsId of pexelsIds) photos.push(await addPhoto(listing, pexelsId, now));
  await updateListing(listingId, { photos }, now);
  for (const old of listing.photos) await dropPhoto(listingId, old.id, now);
  if (listing.status === "published") await enqueueIndexJobs([listingId], { force: true });
  console.log(`${listingId} "${listing.title}": ${listing.photos.length} photo(s) replaced by ${photos.length}`);
}

async function main(): Promise<void> {
  const args = parseListingPhotosCli(process.argv.slice(2));
  const env = serverEnv();
  if (env.APP_ENV !== "staging") throw new Error(`staging only (APP_ENV=${env.APP_ENV})`);
  if (!isFirebaseConfigured()) throw new Error("Firebase is not configured");
  if (args.command === "list") return list();
  if (!args.apply) {
    for (const [listingId, ids] of args.plan) console.log(`Would give ${listingId} the Pexels photos ${ids.join(", ")}`);
    console.log("Dry run: nothing written. Add --apply.");
    return;
  }
  const now = new Date();
  let failed = 0;
  for (const [listingId, ids] of args.plan) {
    try {
      await replace(listingId, ids, now);
    } catch (error) {
      failed += 1;
      console.error(`${listingId}: ${(error as Error).message} (photos unchanged)`);
    }
  }
  if (failed > 0) throw new Error(`${failed} listing(s) not changed`);
}

const self = fileURLToPath(import.meta.url);
if (/[\\/]listing-photos\.(?:ts|mjs)$/.test(self) && process.argv[1] !== undefined && realpathSync(process.argv[1]) === self) {
  main()
    .then(async () => {
      await closeValkey().catch(() => undefined);
      process.exit(0);
    })
    .catch(async (error: unknown) => {
      console.error(`listing-photos: ${(error as Error).message}`);
      await closeValkey().catch(() => undefined);
      process.exit(1);
    });
}
