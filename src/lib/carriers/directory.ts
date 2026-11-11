import "server-only";
import { parseUserRecord, type UserRecord } from "@/lib/db/repositories/profiles";
import { proProfileFromSnapshot, type ProProfileRecord } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { db, isFirebaseConfigured } from "@/lib/firebase/admin";
import { isVisibleAccount, storefrontSegment } from "@/lib/listings/public";
import { storefrontShown } from "@/lib/pro/lifecycle";
import { shopLogoUrl } from "@/lib/pro/logo-url";
import type { CarrierSettings } from "@/lib/pro/profile-schema";
import { consume } from "@/lib/quota";
import { assertQuotas, PUBLIC_READ_QUOTAS } from "@/lib/quota/gate";

// The carriers /transporteurs compares (transporteurs/spec.md §5): every carrier shop whose
// storefront is shown and whose price list is saved, keyed by its owner's publicId (the search
// documents' `sellerPublicId`). One query on the single-field index of `sector` (carrier shops
// only), the owners in one getAll, one process-wide copy for 5 minutes like the shop directory.

const CARRIERS_MAX = 500;
const OWNERS_CHUNK = 100;
const TTL_MS = 5 * 60_000;

export interface CarrierShop {
  proId: string;
  segment: string;
  name: string;
  logo?: string;
  /** Moderator-checked company (KYBC verified): the « Pro vérifié » badge. */
  verified: boolean;
  rating: { avg: number; count: number } | null;
  carrier: CarrierSettings;
  /** Epoch ms of the price list's last change. */
  carrierUpdatedAt: number | null;
}

function toCarrier(profile: ProProfileRecord & { carrier: CarrierSettings }, owner: UserRecord): CarrierShop {
  const { ratingAvg, ratingCount } = owner.stats;
  return {
    proId: profile.proId,
    segment: storefrontSegment(profile.slug, profile.proId),
    name: profile.name,
    ...(profile.logoKey && !profile.example ? { logo: shopLogoUrl(profile.logoKey, "s") ?? undefined } : {}),
    verified: profile.kybc.status === "verified",
    rating: ratingAvg !== undefined && ratingCount > 0 ? { avg: ratingAvg, count: ratingCount } : null,
    carrier: profile.carrier,
    carrierUpdatedAt: profile.carrierUpdatedAt?.getTime() ?? null,
  };
}

async function ownersOf(uids: readonly string[]): Promise<Map<string, UserRecord>> {
  const owners = new Map<string, UserRecord>();
  const unique = [...new Set(uids)];
  for (let start = 0; start < unique.length; start += OWNERS_CHUNK) {
    const snapshots = await db().getAll(...unique.slice(start, start + OWNERS_CHUNK).map((uid) => db().collection(COLLECTIONS.users).doc(uid)));
    void consume("firestore.reads", Math.max(1, snapshots.length));
    for (const snapshot of snapshots) {
      const user = parseUserRecord(snapshot.id, snapshot.data());
      if (user) owners.set(user.uid, user);
    }
  }
  return owners;
}

/** The carrier shops, by their owner's publicId (read afresh). */
export async function listCarrierShops(): Promise<Map<string, CarrierShop>> {
  await assertQuotas(PUBLIC_READ_QUOTAS);
  const snapshot = await db().collection(COLLECTIONS.proProfiles).where("sector", "==", "carrier").limit(CARRIERS_MAX).get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  const profiles = snapshot.docs
    .map(proProfileFromSnapshot)
    .filter((profile): profile is ProProfileRecord & { carrier: CarrierSettings } => profile !== null && profile.carrier !== undefined && storefrontShown(profile.lifecycle, profile.plan));
  const owners = await ownersOf(profiles.map((profile) => profile.ownerUid));
  const shops = new Map<string, CarrierShop>();
  for (const profile of profiles) {
    const owner = owners.get(profile.ownerUid);
    if (owner && isVisibleAccount(owner) && owner.status !== "suspended") shops.set(owner.publicId, toCarrier(profile, owner));
  }
  return shops;
}

let shared: { at: number; shops: Promise<Map<string, CarrierShop>> } | null = null;

/** listCarrierShops through a 5-minute shared copy; a failed read is not kept. Empty without Firebase. */
export function carrierShops(now = Date.now()): Promise<Map<string, CarrierShop>> {
  if (!isFirebaseConfigured()) return Promise.resolve(new Map());
  if (shared && now - shared.at < TTL_MS) return shared.shops;
  const entry = { at: now, shops: listCarrierShops() };
  shared = entry;
  entry.shops.catch(() => {
    if (shared === entry) shared = null;
  });
  return entry.shops;
}

/** Tests: forget the shared copy. */
export function resetCarrierShopsCache(): void {
  shared = null;
}
