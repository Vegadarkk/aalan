import "server-only";
import { DEFAULT_AI, type AiConfig } from "@/config/ai";
import type { AuthContext } from "@/lib/auth/guards";
import type { ProLogoResponse } from "@/lib/contracts/pro";
import { recordModerationDecision } from "@/lib/db/repositories/moderation-decisions";
import { proProfileRef } from "@/lib/db/repositories/pro-profiles";
import { serverEnv } from "@/lib/env";
import { HttpError, unavailable } from "@/lib/http/errors";
import { revalidateListingPaths } from "@/lib/listings/revalidate";
import { logger } from "@/lib/logging/logger";
import { imageClassifier, type ImageClassifier } from "@/lib/media/classify";
import { checkImageType, SNIFF_BYTES } from "@/lib/media/magic";
import { toMediaError } from "@/lib/media/process";
import { INPUT_OPTIONS, MAX_INPUT_PIXELS, openImage, sharp } from "@/lib/media/sharp-setup";
import { MEDIA_CACHE_CONTROL, MEDIA_CONTENT_TYPE } from "@/lib/media/urls";
import { consume } from "@/lib/quota";
import { isStorageNotConfigured, objectStore, type ObjectStore } from "@/lib/storage";
import { isStorageFull, recordMediaBytes } from "@/lib/uploads/storage-gauge";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { storefrontShown } from "./lifecycle";
import { LOGO_VARIANTS, logoObjectKey, shopLogoUrl, type LogoVariant } from "./logo-url";
import { ownedPublishingShop } from "./service";

// The shop's logo (UX audit of the Pro shops, lot 3). The owner sends the image itself as the
// body of PUT /api/pro/me/logo (at most 2 MiB, read capped): its real type is sniffed (JPEG, PNG,
// WebP, as for listing photos), the hardened sharp re-encodes it whole on a transparent square
// (metadata dropped, orientation applied, pixel cap) as WebP 512 and 160 px, and the local
// nudity check reads it on white before anything is stored: a refusal is a recorded automated
// decision. The variants go to the public media bucket under a new key each time (immutable
// cache), the profile points at it, the previous ones are deleted. Done inline: one small image.

const VARIANTS = Object.keys(LOGO_VARIANTS) as LogoVariant[];
const WEBP = { quality: 88, alphaQuality: 90, effort: 4 } as const;
const AUTOMATED_GROUND = "CGU §7 (contrôle avant publication)";

export interface LogoDeps {
  store?: ObjectStore;
  classifier?: ImageClassifier;
  ai?: AiConfig;
  now?: Date;
}

function storeOf(deps: LogoDeps): ObjectStore {
  if (deps.store) return deps.store;
  try {
    return objectStore();
  } catch (error) {
    if (isStorageNotConfigured(error)) throw unavailable("object storage is not configured");
    throw error;
  }
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 } as const;

/** The two variants, or the refusal as an HTTP error (type, size, undecodable). */
async function encodeLogo(input: Buffer): Promise<Record<LogoVariant, Buffer>> {
  try {
    const meta = await sharp(input, INPUT_OPTIONS).metadata();
    if (!meta.width || !meta.height) throw new HttpError(422, "unsupported_media", "logo has no dimensions");
    if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new HttpError(413, "file_too_large", "logo exceeds the pixel limit");
    const large = await openImage(input).rotate().resize(LOGO_VARIANTS.l, LOGO_VARIANTS.l, { fit: "contain", background: transparent }).webp(WEBP).toBuffer();
    const small = await openImage(large).resize(LOGO_VARIANTS.s, LOGO_VARIANTS.s, { fit: "contain", background: transparent }).webp(WEBP).toBuffer();
    return { l: large, s: small };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const reason = toMediaError(error).reason;
    if (reason === "too_large") throw new HttpError(413, "file_too_large", "logo exceeds the pixel limit");
    throw new HttpError(422, "unsupported_media", "logo could not be decoded");
  }
}

async function deleteQuietly(store: ObjectStore, keys: readonly string[], proId: string): Promise<void> {
  for (const key of keys) {
    try {
      await store.delete("media", key);
    } catch (error) {
      logger.warn({ proId, err: (error as Error).message }, "previous logo variant not deleted");
    }
  }
}

async function storedBytes(store: ObjectStore, keys: readonly string[]): Promise<number> {
  let total = 0;
  for (const key of keys) {
    try {
      total += (await store.head("media", key))?.size ?? 0;
    } catch {
      // Unknown size: the nightly recount of the gauge corrects it.
    }
  }
  return total;
}

const variantKeys = (logoKey: string | undefined) => (logoKey ? VARIANTS.map((variant) => logoObjectKey(logoKey, variant)) : []);

/** PUT /api/pro/me/logo: `body` is the image as sent, `declaredType` its Content-Type. */
export async function updateLogo(auth: AuthContext, body: Uint8Array, declaredType: string, deps: LogoDeps = {}): Promise<ProLogoResponse> {
  const profile = await ownedPublishingShop(auth);
  const store = storeOf(deps);
  const now = deps.now ?? new Date();
  if (await isStorageFull()) throw new HttpError(503, "storage_full", undefined, { headers: { "Retry-After": "3600" } });
  if (body.byteLength === 0 || "reason" in checkImageType(body.subarray(0, SNIFF_BYTES), declaredType)) throw new HttpError(415, "unsupported_media", "logo is not a JPEG, PNG or WebP image");

  const variants = await encodeLogo(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  const ai = deps.ai ?? DEFAULT_AI;
  const classifier = deps.classifier ?? imageClassifier(serverEnv(), ai);
  const onWhite = await openImage(variants.l).flatten({ background: "#ffffff" }).webp({ quality: 90 }).toBuffer();
  const { nsfw } = await classifier.classify(onWhite);
  if (nsfw >= ai.nsfw.rejectAt) {
    try {
      await recordModerationDecision({
        target: { type: "shop_logo", id: profile.proId },
        affectedUid: auth.user.uid,
        action: "remove",
        facts: `shop logo nudity score ${nsfw.toFixed(2)} >= ${ai.nsfw.rejectAt}`,
        origin: "own_initiative",
        automation: { detection: true, decision: true },
        ground: { type: "terms", ref: AUTOMATED_GROUND, explanation: "Automated nudity check refused the shop logo at upload; it was never published." },
        reportIds: [],
        templateId: "photoRejectedNsfw",
        decidedBy: "system",
        notified: true,
        now,
      });
    } catch (error) {
      logger.error({ proId: profile.proId, err: (error as Error).message }, "logo refusal not recorded");
    }
    throw new HttpError(422, "image_refused", "logo refused by the automated image check");
  }

  const logoKey = `shops/${profile.proId}/logo-${now.getTime().toString(36)}`;
  const previous = variantKeys(profile.logoKey).filter((key) => !key.startsWith(`${logoKey}-`));
  for (const variant of VARIANTS) {
    await store.put("media", logoObjectKey(logoKey, variant), variants[variant], { contentType: MEDIA_CONTENT_TYPE, cacheControl: MEDIA_CACHE_CONTROL });
  }
  const freed = await storedBytes(store, previous);
  await proProfileRef(profile.proId).update({ logoKey, updatedAt: Timestamp.fromDate(now) });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);
  await deleteQuietly(store, previous, profile.proId);
  await recordMediaBytes(variants.l.byteLength + variants.s.byteLength - freed, now);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  logger.info({ proId: profile.proId, bytes: variants.l.byteLength + variants.s.byteLength }, "shop logo stored");
  return { logo: shopLogoUrl(logoKey, "l") };
}

/** DELETE /api/pro/me/logo: back to the emblem. */
export async function deleteLogo(auth: AuthContext, deps: Pick<LogoDeps, "store" | "now"> = {}): Promise<ProLogoResponse> {
  const profile = await ownedPublishingShop(auth);
  if (!profile.logoKey) return { logo: null };
  const store = storeOf(deps);
  const now = deps.now ?? new Date();
  const keys = variantKeys(profile.logoKey);
  const freed = await storedBytes(store, keys);
  await proProfileRef(profile.proId).update({ logoKey: FieldValue.delete(), updatedAt: Timestamp.fromDate(now) });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);
  await deleteQuietly(store, keys, profile.proId);
  if (freed > 0) await recordMediaBytes(-freed, now);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  return { logo: null };
}
