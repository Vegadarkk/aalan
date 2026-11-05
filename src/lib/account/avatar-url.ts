import "server-only";
import { serverEnv } from "@/lib/env";
import { mediaBaseUrl } from "@/lib/storage/keys";

// Keys and public URLs of a member's profile photo (src/lib/account/avatar.ts):
// `avatars/{publicId}/a-{version}` in users/{uid}.avatarKey, plus `-{variant}.webp` per stored
// size. The public id, never the uid, names the folder: the URL is public.

/** Portrait 4:5, the arch of SellerAvatar: large for /profil, small for the seller card. */
export const AVATAR_VARIANTS = { l: { width: 320, height: 400 }, s: { width: 128, height: 160 } } as const;
export type AvatarVariant = keyof typeof AVATAR_VARIANTS;

export const AVATAR_KEY_PATTERN = /^avatars\/[a-hj-km-np-z2-9]{10}\/a-[a-z0-9]{1,12}$/;

export const avatarObjectKey = (avatarKey: string, variant: AvatarVariant) => `${avatarKey}-${variant}.webp`;

/** The stored objects of a key (none without a valid key). */
export function avatarObjectKeys(avatarKey: string | undefined): string[] {
  if (!avatarKey || !AVATAR_KEY_PATTERN.test(avatarKey)) return [];
  return (Object.keys(AVATAR_VARIANTS) as AvatarVariant[]).map((variant) => avatarObjectKey(avatarKey, variant));
}

/** The public URL of a variant, null without a valid key or a media origin. */
export function avatarUrl(avatarKey: string | undefined, variant: AvatarVariant): string | null {
  if (!avatarKey || !AVATAR_KEY_PATTERN.test(avatarKey)) return null;
  const base = mediaBaseUrl(serverEnv());
  return base ? `${base}/${avatarObjectKey(avatarKey, variant)}` : null;
}

/** Both URLs for the public pages, or null. */
export function avatarUrls(avatarKey: string | undefined): { small: string; large: string } | null {
  const small = avatarUrl(avatarKey, "s");
  const large = avatarUrl(avatarKey, "l");
  return small && large ? { small, large } : null;
}
