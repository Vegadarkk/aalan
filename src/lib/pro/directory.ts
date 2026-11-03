import "server-only";
import { db, isFirebaseConfigured } from "@/lib/firebase/admin";
import { parseUserRecord, type UserRecord } from "@/lib/db/repositories/profiles";
import { proProfileFromSnapshot, type ProProfileRecord } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { isVisibleAccount, storefrontSegment } from "@/lib/listings/public";
import { storefrontShown } from "@/lib/pro/lifecycle";
import { consume } from "@/lib/quota";
import { assertQuotas, PUBLIC_READ_QUOTAS } from "@/lib/quota/gate";
import { excerptOf, type DirectoryShop } from "./directory-view";

// The shops listed by /boutiques: every Pro profile whose storefront is shown (`storefrontShown`:
// verified, active or in grace, with a plan) and whose owner has a public face and is not
// suspended, as the storefront page decides for one shop. One query on the single-field index of
// `lifecycle`, then the owners in a few getAll; the ISR page keeps the result five minutes. The
// cap is the launch's scale: a directory beyond it gets paging and an index of its own.

/** The states `storefrontShown` accepts, as the query's `in` clause. */
const SHOWN_STATES = ["verified", "active", "grace"] as const;
const DIRECTORY_MAX = 500;
const OWNERS_CHUNK = 100;

async function ownersOf(uids: readonly string[]): Promise<Map<string, UserRecord>> {
  const owners = new Map<string, UserRecord>();
  const unique = [...new Set(uids)];
  for (let start = 0; start < unique.length; start += OWNERS_CHUNK) {
    const refs = unique.slice(start, start + OWNERS_CHUNK).map((uid) => db().collection(COLLECTIONS.users).doc(uid));
    const snapshots = await db().getAll(...refs);
    void consume("firestore.reads", Math.max(1, snapshots.length));
    for (const snapshot of snapshots) {
      const user = parseUserRecord(snapshot.id, snapshot.data());
      if (user) owners.set(user.uid, user);
    }
  }
  return owners;
}

function toShop(profile: ProProfileRecord, owner: UserRecord): DirectoryShop {
  return {
    proId: profile.proId,
    segment: storefrontSegment(profile.slug, profile.proId),
    name: profile.name,
    excerpt: excerptOf(profile.description),
    citySlug: profile.citySlug,
    sector: profile.sector ?? "general",
    example: profile.example === true,
    certified: profile.certified !== undefined && profile.example !== true,
    ownerPublicId: owner.publicId,
    listings: owner.stats.activeListings,
    ...(profile.bannerKey ? { bannerKey: profile.bannerKey } : {}),
  };
}

/** One process-wide copy for 5 minutes, the ISR period: the directory (3 locales, its filter
 *  pages) and the home page's row share it instead of each reading every shop again. */
const SHARED_TTL_MS = 5 * 60_000;
let shared: { at: number; shops: Promise<DirectoryShop[]> } | null = null;

/** listDirectoryShops through the shared copy; a failed read is not kept. */
export function directoryShops(now = Date.now()): Promise<DirectoryShop[]> {
  if (shared && now - shared.at < SHARED_TTL_MS) return shared.shops;
  const entry = { at: now, shops: listDirectoryShops() };
  shared = entry;
  entry.shops.catch(() => {
    if (shared === entry) shared = null;
  });
  return entry.shops;
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();
let names: { shops: Promise<DirectoryShop[]>; map: Promise<ReadonlyMap<string, string>> } | null = null;

/**
 * Shop names by their owner's publicId, for the cards of Pro listings (UX audit of the Pro shops,
 * lot 2), from the shared copy. Empty without Firebase or when the directory cannot be read: a card
 * then shows the « Pro » badge alone.
 */
export function shopNamesByPublicId(): Promise<ReadonlyMap<string, string>> {
  if (!isFirebaseConfigured()) return Promise.resolve(NO_NAMES);
  const shops = directoryShops();
  if (names?.shops !== shops) {
    names = { shops, map: shops.then((list) => new Map(list.map((shop) => [shop.ownerPublicId, shop.name] as const))).catch(() => NO_NAMES) };
  }
  return names.map;
}

/** Tests: forget the shared copy. */
export function resetDirectoryShopsCache(): void {
  shared = null;
  names = null;
}

/** The shops of the directory, unsorted (the view sorts and filters). */
export async function listDirectoryShops(): Promise<DirectoryShop[]> {
  await assertQuotas(PUBLIC_READ_QUOTAS);
  const snapshot = await db().collection(COLLECTIONS.proProfiles).where("lifecycle", "in", [...SHOWN_STATES]).limit(DIRECTORY_MAX).get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  const profiles = snapshot.docs.map(proProfileFromSnapshot).filter((profile): profile is ProProfileRecord => profile !== null && storefrontShown(profile.lifecycle, profile.plan));
  const owners = await ownersOf(profiles.map((profile) => profile.ownerUid));
  return profiles.flatMap((profile) => {
    const owner = owners.get(profile.ownerUid);
    return owner && isVisibleAccount(owner) && owner.status !== "suspended" ? [toShop(profile, owner)] : [];
  });
}
