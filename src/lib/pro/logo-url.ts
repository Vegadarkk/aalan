import "server-only";
import { serverEnv } from "@/lib/env";
import { mediaBaseUrl } from "@/lib/storage/keys";

// Keys and public URLs of a shop's logo (src/lib/pro/logo.ts): `shops/{proId}/logo-{version}`
// in the profile, plus `-{variant}.webp` per stored size.

export const LOGO_VARIANTS = { l: 512, s: 160 } as const;
export type LogoVariant = keyof typeof LOGO_VARIANTS;

export const LOGO_KEY_PATTERN = /^shops\/[a-z0-9]{8}\/logo-[a-z0-9]{1,12}$/;

export const logoObjectKey = (logoKey: string, variant: LogoVariant) => `${logoKey}-${variant}.webp`;

/** The public URL of a variant, null without a valid key or a media origin. */
export function shopLogoUrl(logoKey: string | undefined, variant: LogoVariant): string | null {
  if (!logoKey || !LOGO_KEY_PATTERN.test(logoKey)) return null;
  const base = mediaBaseUrl(serverEnv());
  return base ? `${base}/${logoObjectKey(logoKey, variant)}` : null;
}
