import "server-only";
import { DEFAULT_FLAGS, type FlagsConfig } from "@/config/flags";
import { DEFAULT_PRICING, type PricingConfig } from "@/config/pricing";
import { MAX_UPLOAD_BYTES } from "@/lib/contracts/media";
import { serverEnv, type ServerEnv } from "@/lib/env";
import { isPhoneVerificationConfigured } from "@/lib/phone-verify/config";
import { mediaBaseUrl } from "@/lib/storage/keys";
import type { PublicConfig } from "./public-types";

export type { PublicConfig, PublicFirebaseConfig, PublicMapConfig, PublicUploadLimits } from "./public-types";

/** Upload limits shown to the browser; the API enforces the same values (design §3, config/pricing). */
function uploadLimits(pricing: Pick<PricingConfig, "individual" | "pro">): PublicConfig["upload"] {
  return { maxBytes: MAX_UPLOAD_BYTES, maxPhotos: pricing.individual.photosPerListing, maxPhotosPro: pricing.pro.none.photosPerListing };
}

/** OSM data (ODbL) through Protomaps: shown on every map (D10). */
export const MAP_ATTRIBUTION = "© OpenStreetMap contributors · Protomaps";

/**
 * The basemap of the search page and the home page's map (Carte vivante), read when the page
 * renders: per request on /recherche, at the ISR render on the home page (never at build).
 */
export function searchMapConfig(env: ServerEnv = serverEnv()): PublicConfig["map"] {
  return env.MAP_PMTILES_URL ? { pmtilesUrl: env.MAP_PMTILES_URL, attribution: MAP_ATTRIBUTION } : null;
}

/**
 * The browser's configuration, built from the server environment at request time; the ad flags
 * come from config/flags (getFlags) and the photo limits from config/pricing (getPricing), the
 * defaults (ads off) when the caller has none.
 */
export function publicConfig(
  env: ServerEnv = serverEnv(),
  flags: Pick<FlagsConfig, "adsMode" | "adsCmpEea"> = DEFAULT_FLAGS,
  pricing: Pick<PricingConfig, "individual" | "pro"> = DEFAULT_PRICING,
): PublicConfig {
  const firebase = env.FIREBASE_PROJECT_ID ? { projectId: env.FIREBASE_PROJECT_ID } : null;
  return {
    env: env.APP_ENV,
    siteUrl: new URL(env.SITE_URL).origin,
    firebase,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
    googleClientId: env.GOOGLE_OAUTH_CLIENT_ID ?? null,
    sentry: env.SENTRY_DSN ? { dsn: env.SENTRY_DSN, environment: env.APP_ENV, release: env.RELEASE ?? "dev" } : null,
    // R2 keys and bucket names never leave the server: only the public media host is shared.
    mediaBaseUrl: mediaBaseUrl(env),
    upload: uploadLimits(pricing),
    map: searchMapConfig(env),
    phoneVerification: isPhoneVerificationConfigured(env),
    ads: {
      mode: flags.adsMode,
      cmpEea: flags.adsCmpEea,
      client: env.ADSENSE_CLIENT_ID ?? null,
      units: { leaderboard: env.AD_SLOT_LEADERBOARD ?? null, halfpage: env.AD_SLOT_HALFPAGE ?? null, rectangle: env.AD_SLOT_RECTANGLE ?? null, banner: env.AD_SLOT_BANNER ?? null },
    },
  };
}
