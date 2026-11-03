import "server-only";
import type { AuthContext } from "@/lib/auth/guards";
import type { Device } from "@/lib/auth/respond";
import { alert } from "@/lib/alert";
import type { PhoneRevealResponse } from "@/lib/contracts/listings";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { getUserRecord } from "@/lib/db/repositories/profiles";
import { countRevealsSince, hasRevealed, recordReveal } from "@/lib/db/repositories/reveal-logs";
import { getUserPrivate } from "@/lib/db/repositories/users";
import { HttpError, notFound } from "@/lib/http/errors";
import { escalateOnIp } from "@/lib/listings/escalation";
import { MIN_ACCOUNT_AGE_MS, REVEAL_ALERT_PER_DAY, whatsappUrl, type RevealOutcome } from "@/lib/listings/phone-reveal";
import { SELLER_UNREACHABLE } from "@/lib/listings/public";
import { logger } from "@/lib/logging/logger";
import { displayPhone } from "@/lib/phone/normalize";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { countReveal } from "@/lib/stats/counters";
import { storefrontShown } from "./lifecycle";

// A shop's number from its storefront (UX audit of the Pro shops, lot 1): the listing reveal
// rules exactly (src/lib/listings/phone-reveal.ts: account older than 24 hours with a verified
// e-mail, the same limiters, Turnstile past the IP budget, logged in revealLogs for 90 days, a
// repeat not counted), for a shown storefront whose owner turned the number or WhatsApp on and
// whose account number is verified. The number never sits in the cached page.

export interface ShopRevealOptions {
  turnstileToken?: string;
  device: Device;
  now?: Date;
}

export async function revealShopPhone(auth: AuthContext, request: Request, proId: string, options: ShopRevealOptions): Promise<RevealOutcome> {
  const now = options.now ?? new Date();
  const viewer = await getUserRecord(auth.user.uid);
  if (!viewer) throw new HttpError(403, "forbidden", "account record missing");
  const emailVerified = viewer.badges.emailVerified || auth.user.emailVerified;
  if (!emailVerified || now.getTime() - viewer.createdAt.getTime() < MIN_ACCOUNT_AGE_MS) throw new HttpError(403, "reveal_not_allowed");

  const profile = await getProProfile(proId);
  // Unknown shop, storefront not shown, example shop, or no contact switch on: the same 404.
  if (!profile || !storefrontShown(profile.lifecycle, profile.plan) || profile.example || (profile.showPhone !== true && !profile.whatsapp)) throw notFound();

  const repeat = await hasRevealed(viewer.uid, profile.proId);
  let turnstilePassed = false;
  if (!repeat) {
    await enforceLimit("reveal.uid.hour", viewer.uid);
    await enforceLimit("reveal.uid.day", viewer.uid);
    await enforceLimit("reveal.device", options.device.identity.deviceKey);
    turnstilePassed = await escalateOnIp(request, "reveal.ip", options.device, options.turnstileToken, "listing");
  }

  const [owner, account] = await Promise.all([getUserRecord(profile.ownerUid), getUserPrivate(profile.ownerUid)]);
  if (!owner || SELLER_UNREACHABLE.includes(owner.status) || owner.status === "suspended") throw new HttpError(409, "listing_unavailable");
  if (!owner.badges.phoneVerified || !account?.phoneE164) throw notFound();

  if (!repeat) {
    await recordReveal({ viewerUid: viewer.uid, listingId: profile.proId, kind: "shop", ip: options.device.identity.ip, deviceKey: options.device.identity.deviceKey, now });
    void countReveal(profile.proId, now);
    void watchScraping(profile.proId, now);
  }

  const e164 = account.phoneE164;
  const body: PhoneRevealResponse = { phone: { e164, display: displayPhone(e164), ...(profile.whatsapp ? { whatsappUrl: whatsappUrl(e164) } : {}) } };
  return { response: body, turnstilePassed };
}

/** Alerts once a shop passes REVEAL_ALERT_PER_DAY reveals in 24 hours (never throws). */
async function watchScraping(proId: string, now: Date): Promise<void> {
  try {
    const count = await countRevealsSince(proId, new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (count === REVEAL_ALERT_PER_DAY) {
      await alert({ severity: "P2", title: `Révélations de numéro anormales : boutique ${proId}`, body: `${count} révélations en 24 heures depuis une seule vitrine (seuil ${REVEAL_ALERT_PER_DAY}). Vérifier revealLogs (préfixes IP, appareils).` });
    }
  } catch (error) {
    logger.warn({ err: (error as Error).message, proId }, "shop reveal count unavailable");
  }
}
