import "server-only";
import { DEFAULT_AI, type AiConfig } from "@/config/ai";
import { decisionTemplate, fillTemplateText } from "@/config/decision-templates";
import { audit } from "@/lib/audit";
import { requireStaff, requireUser } from "@/lib/auth/guards";
import { adminAvatarRemoveSchema, AVATAR_MAX_BYTES, AVATAR_TYPES, type AvatarResponse } from "@/lib/contracts/account";
import { listPublishedByOwner } from "@/lib/db/repositories/listings";
import { appealDeadlineAt, recordModerationDecision } from "@/lib/db/repositories/moderation-decisions";
import { getUserRecord, type UserRecord } from "@/lib/db/repositories/profiles";
import { setAvatarKey } from "@/lib/db/repositories/users";
import { sendDecisionNotice } from "@/lib/decisions/notify";
import { serverEnv } from "@/lib/env";
import { readCappedBytes } from "@/lib/http/body";
import { HttpError, notFound, unavailable } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { json, noContent } from "@/lib/http/route";
import { revalidateListingPaths } from "@/lib/listings/revalidate";
import { logger } from "@/lib/logging/logger";
import { imageClassifier, type ImageClassifier } from "@/lib/media/classify";
import { checkImageType, SNIFF_BYTES } from "@/lib/media/magic";
import { toMediaError } from "@/lib/media/process";
import { INPUT_OPTIONS, MAX_INPUT_PIXELS, openImage, sharp } from "@/lib/media/sharp-setup";
import { MEDIA_CACHE_CONTROL, MEDIA_CONTENT_TYPE } from "@/lib/media/urls";
import { consume } from "@/lib/quota";
import { requestIdentity } from "@/lib/rate-limit/keys";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { isStorageNotConfigured, objectStore, type ObjectStore } from "@/lib/storage";
import { isStorageFull, recordMediaBytes } from "@/lib/uploads/storage-gauge";
import { z } from "@/lib/zod";
import { AVATAR_VARIANTS, avatarObjectKey, avatarObjectKeys, avatarUrl, type AvatarVariant } from "./avatar-url";

// The member's profile photo (spec users.avatarKey; audit synthesis §7 "photo de profil d'un
// particulier"), on the model of the shop logo (src/lib/pro/logo.ts). The member sends the image
// itself as the body of PUT /api/account/avatar (at most 4 MiB, read capped): its real type is
// sniffed (JPEG, PNG, WebP), the hardened sharp re-encodes it whole (metadata dropped, orientation
// applied, pixel cap), cropped to the 4:5 arch of the seller avatar as WebP 320x400 and 128x160,
// and the local nudity check reads it before anything is stored: a refusal is a recorded automated
// decision. The variants go to the public media bucket under a new key each time (immutable
// cache), the account points at it, the previous ones are deleted (their CDN copies purged by the
// store). A moderator removes a photo from the account page with a statement of reasons
// (template user.avatar.remove); the account closure deletes it.

const VARIANTS = Object.keys(AVATAR_VARIANTS) as AvatarVariant[];
const WEBP = { quality: 84, effort: 4 } as const;
const AUTOMATED_GROUND = "CGU §7 (contrôle avant publication)";
/** Listing pages whose seller card is revalidated after a change (the newest first). */
const LISTING_PAGES_MAX = 100;
const REMOVE_TEMPLATE = "user.avatar.remove";

export interface AvatarDeps {
  store?: ObjectStore;
  classifier?: ImageClassifier;
  ai?: AiConfig;
  now?: Date;
}

function storeOf(deps: AvatarDeps): ObjectStore {
  if (deps.store) return deps.store;
  try {
    return objectStore();
  } catch (error) {
    if (isStorageNotConfigured(error)) throw unavailable("object storage is not configured");
    throw error;
  }
}

/** The two variants, or the refusal as an HTTP error (type, size, undecodable). */
export async function encodeAvatar(input: Buffer): Promise<Record<AvatarVariant, Buffer>> {
  try {
    const meta = await sharp(input, INPUT_OPTIONS).metadata();
    if (!meta.width || !meta.height) throw new HttpError(422, "unsupported_media", "photo has no dimensions");
    if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new HttpError(413, "file_too_large", "photo exceeds the pixel limit");
    const { l, s } = AVATAR_VARIANTS;
    // Flattened on white: a transparent PNG never shows the page behind it inside the arch.
    const large = await openImage(input).rotate().flatten({ background: "#ffffff" }).resize(l.width, l.height, { fit: "cover", position: "attention" }).webp(WEBP).toBuffer();
    const small = await openImage(large).resize(s.width, s.height, { fit: "cover" }).webp(WEBP).toBuffer();
    return { l: large, s: small };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const reason = toMediaError(error).reason;
    if (reason === "too_large") throw new HttpError(413, "file_too_large", "photo exceeds the pixel limit");
    throw new HttpError(422, "unsupported_media", "photo could not be decoded");
  }
}

async function deleteQuietly(store: ObjectStore, keys: readonly string[], uid: string): Promise<void> {
  for (const key of keys) {
    try {
      await store.delete("media", key);
    } catch (error) {
      logger.warn({ uid, err: (error as Error).message }, "avatar variant not deleted");
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

/** The profile and the seller card of the member's listings show the change (best effort). */
async function revalidateFaces(user: UserRecord): Promise<void> {
  revalidateListingPaths({ publicId: user.publicId });
  try {
    for (const listing of await listPublishedByOwner(user.uid, LISTING_PAGES_MAX)) {
      if (listing.slugId) revalidateListingPaths({ slugId: listing.slugId });
    }
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "avatar: listing pages not revalidated");
  }
}

async function currentUser(uid: string): Promise<UserRecord> {
  const user = await getUserRecord(uid);
  void consume("firestore.reads", 1);
  if (!user) throw notFound();
  return user;
}

/** Stores a new photo for `uid`; `body` is the image as sent, `declaredType` its Content-Type. */
export async function updateAvatar(uid: string, body: Uint8Array, declaredType: string, deps: AvatarDeps = {}): Promise<AvatarResponse> {
  const user = await currentUser(uid);
  const store = storeOf(deps);
  const now = deps.now ?? new Date();
  if (await isStorageFull()) throw new HttpError(503, "storage_full", undefined, { headers: { "Retry-After": "3600" } });
  if (body.byteLength === 0 || "reason" in checkImageType(body.subarray(0, SNIFF_BYTES), declaredType)) throw new HttpError(415, "unsupported_media", "photo is not a JPEG, PNG or WebP image");

  const variants = await encodeAvatar(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  const ai = deps.ai ?? DEFAULT_AI;
  const classifier = deps.classifier ?? imageClassifier(serverEnv(), ai);
  const { nsfw } = await classifier.classify(variants.l);
  if (nsfw >= ai.nsfw.rejectAt) {
    try {
      await recordModerationDecision({
        target: { type: "user", id: uid },
        affectedUid: uid,
        action: "remove",
        facts: `profile photo nudity score ${nsfw.toFixed(2)} >= ${ai.nsfw.rejectAt}`,
        origin: "own_initiative",
        automation: { detection: true, decision: true },
        ground: { type: "terms", ref: AUTOMATED_GROUND, explanation: "Automated nudity check refused the profile photo at upload; it was never published." },
        reportIds: [],
        templateId: "photoRejectedNsfw",
        decidedBy: "system",
        notified: true,
        now,
      });
    } catch (error) {
      logger.error({ err: (error as Error).message }, "avatar refusal not recorded");
    }
    throw new HttpError(422, "image_refused", "photo refused by the automated image check");
  }

  const avatarKey = `avatars/${user.publicId}/a-${now.getTime().toString(36)}`;
  const previous = avatarObjectKeys(user.avatarKey).filter((key) => !key.startsWith(`${avatarKey}-`));
  for (const variant of VARIANTS) {
    await store.put("media", avatarObjectKey(avatarKey, variant), variants[variant], { contentType: MEDIA_CONTENT_TYPE, cacheControl: MEDIA_CACHE_CONTROL });
  }
  const freed = await storedBytes(store, previous);
  await setAvatarKey(uid, avatarKey, now);
  await deleteQuietly(store, previous, uid);
  await recordMediaBytes(variants.l.byteLength + variants.s.byteLength - freed, now);
  await revalidateFaces(user);
  logger.info({ bytes: variants.l.byteLength + variants.s.byteLength }, "avatar stored");
  return { avatar: avatarUrl(avatarKey, "l") };
}

/**
 * Removes the photo of `uid` (the member, a moderator, the account closure). False when there was
 * none. The field goes first: a failed object delete leaves an orphan the gauge recount sees, never
 * a profile pointing at a missing image.
 */
export async function removeAvatar(uid: string, deps: Pick<AvatarDeps, "store" | "now"> = {}): Promise<boolean> {
  const user = await currentUser(uid);
  if (!user.avatarKey) return false;
  const store = storeOf(deps);
  const now = deps.now ?? new Date();
  const keys = avatarObjectKeys(user.avatarKey);
  const freed = await storedBytes(store, keys);
  await setAvatarKey(uid, null, now);
  await deleteQuietly(store, keys, uid);
  if (freed > 0) await recordMediaBytes(-freed, now);
  await revalidateFaces(user);
  return true;
}

/** Account closure (src/lib/account/close.ts): never fails the closure. */
export async function removeAvatarQuietly(uid: string, now = new Date()): Promise<void> {
  try {
    await removeAvatar(uid, { now });
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "account closure: avatar not removed");
  }
}

// ---- Handlers -----------------------------------------------------------------------------------

/**
 * PUT /api/account/avatar: the image itself as the body (Content-Type image/jpeg, png or webp, at
 * most AVATAR_MAX_BYTES, read capped); 10 a day, and its bytes count in the daily upload budget.
 */
export async function handleAvatarPut(request: Request): Promise<Response> {
  const { user } = await requireUser(request, { mutation: true });
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!(AVATAR_TYPES as readonly string[]).includes(type)) throw new HttpError(415, "unsupported_media", "photo must be sent as image/jpeg, image/png or image/webp");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > AVATAR_MAX_BYTES) throw new HttpError(413, "file_too_large", "photo too large");
  await enforceLimit("account.avatar.uid", user.uid);
  const body = await readCappedBytes(request.body, AVATAR_MAX_BYTES);
  if (!body) throw new HttpError(413, "file_too_large", "photo too large");
  await enforceLimit("upload.bytes.uid", user.uid, Math.max(1, body.byteLength));
  return json(await updateAvatar(user.uid, body, type));
}

/** DELETE /api/account/avatar: back to the initial. */
export async function handleAvatarDelete(request: Request): Promise<Response> {
  const { user } = await requireUser(request, { mutation: true });
  await enforceLimit("account.avatar.uid", user.uid);
  await removeAvatar(user.uid);
  return json<AvatarResponse>({ avatar: null });
}

const uidParam = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/**
 * DELETE /api/admin/users/{uid}/avatar: a moderator removes the photo (body { details }, quoted in
 * the statement of reasons). Recorded as a decision (template user.avatar.remove, art. 17 DSA),
 * audited, and the member gets the statement with the appeal link.
 */
export async function handleStaffAvatarRemove(request: Request, context: { params: Promise<Record<string, string | string[] | undefined>> }): Promise<Response> {
  const staff = await requireStaff(request, { mutation: true, roles: ["moderator", "admin"] });
  const parsed = uidParam.safeParse((await context.params).uid);
  if (!parsed.success) throw notFound();
  const uid = parsed.data;
  await enforceLimit("moderation.decision.uid", staff.user.uid);
  const { details } = await readJson(request, adminAvatarRemoveSchema);
  const template = decisionTemplate(REMOVE_TEMPLATE);
  if (!template) throw new Error(`decision template ${REMOVE_TEMPLATE} missing`);
  const now = new Date();
  if (!(await removeAvatar(uid, { now }))) throw new HttpError(409, "conflict", "no profile photo on this account");
  const decisionId = await recordModerationDecision({
    target: { type: "user", id: uid },
    affectedUid: uid,
    action: "remove",
    facts: `${fillTemplateText(template.facts.fr, {})}\n\n${details}`.slice(0, 2000),
    origin: "own_initiative",
    automation: { detection: false, decision: false },
    ground: { type: template.ground.type, ref: template.ground.ref, explanation: fillTemplateText(template.explanation.fr, {}) },
    reportIds: [],
    templateId: template.id,
    decidedBy: staff.user.uid,
    notified: true,
    now,
  });
  await audit({ actorUid: staff.user.uid, actorRole: staff.role, action: "user.avatar_removed", target: { type: "user", id: uid }, automated: false, ip: requestIdentity(request.headers).ip, reason: details });
  await sendDecisionNotice({
    decisionId,
    templateId: template.id,
    action: "remove",
    targetType: "user",
    affectedUid: uid,
    title: null,
    details,
    durationDays: null,
    until: null,
    source: "own_initiative",
    automation: { detection: false, decision: false },
    appealDeadline: appealDeadlineAt(now),
  });
  return noContent();
}
