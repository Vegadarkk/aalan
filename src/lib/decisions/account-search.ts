import "server-only";
import { audit } from "@/lib/audit";
import { db } from "@/lib/firebase/admin";
import { getListing } from "@/lib/db/repositories/listings";
import { findUserByPublicId, getUserRecord, parseUserRecord, type UserRecord } from "@/lib/db/repositories/profiles";
import { findUidByEmail } from "@/lib/db/repositories/users";
import { COLLECTIONS } from "@/lib/db/schemas";
import { consume } from "@/lib/quota";
import { accountLookups, namePrefixes, type AccountLookup } from "./account-query";

// Back-office account search (B12, audit zone 7 P1-1): a member who writes to the support gives an
// e-mail, a phone, a name or a listing, never an id. Every lookup is an exact key or a short
// prefix range (bounded reads). Results show the account's conduct fields only (design D24: no
// e-mail or phone on screen); an e-mail or phone lookup is audited without the value searched.

export const NAME_RESULTS_MAX = 10;

export type AccountMatch = AccountLookup["kind"];

export interface AccountHit {
  uid: string;
  publicId: string;
  displayName: string;
  type: UserRecord["type"];
  status: UserRecord["status"];
  createdAt: string;
  activeListings: number;
  matched: AccountMatch[];
}

export interface Searcher {
  uid: string;
  role: "moderator" | "admin";
}

async function uidsByPhone(e164: string): Promise<string[]> {
  const snapshot = await db().collectionGroup(COLLECTIONS.userPrivate).where("phoneE164", "==", e164).limit(5).get();
  void consume("firestore.reads", Math.max(1, snapshot.size));
  // Only users/{uid}/private documents: another collection may have a "private" subcollection.
  return snapshot.docs.flatMap((doc) => {
    const owner = doc.ref.parent.parent;
    return owner && owner.parent.id === COLLECTIONS.users ? [owner.id] : [];
  });
}

async function usersByNamePrefix(prefix: string): Promise<UserRecord[]> {
  const found = await Promise.all(
    namePrefixes(prefix).map(async (start) => {
      const snapshot = await db().collection(COLLECTIONS.users).where("displayName", ">=", start).where("displayName", "<", `${start}`).limit(NAME_RESULTS_MAX).get();
      void consume("firestore.reads", Math.max(1, snapshot.size));
      return snapshot.docs.map((doc) => parseUserRecord(doc.id, doc.data())).filter((user): user is UserRecord => user !== null);
    }),
  );
  return found.flat();
}

async function run(lookup: AccountLookup): Promise<UserRecord[]> {
  switch (lookup.kind) {
    case "email": {
      const uid = await findUidByEmail(lookup.email);
      const user = uid ? await getUserRecord(uid) : null;
      return user ? [user] : [];
    }
    case "phone": {
      const users = await Promise.all((await uidsByPhone(lookup.e164)).map(getUserRecord));
      return users.filter((user): user is UserRecord => user !== null);
    }
    case "profile": {
      const user = await findUserByPublicId(lookup.publicId);
      return user ? [user] : [];
    }
    case "listing": {
      const listing = await getListing(lookup.listingId);
      const user = listing ? await getUserRecord(listing.ownerUid) : null;
      return user ? [user] : [];
    }
    case "uid": {
      const user = await getUserRecord(lookup.uid);
      return user ? [user] : [];
    }
    case "name":
      return usersByNamePrefix(lookup.prefix);
  }
}

export async function searchAccounts(searcher: Searcher, query: string, options: { ip?: string; now?: Date } = {}): Promise<AccountHit[]> {
  return searchAccountLookups(searcher, accountLookups(query), options);
}

/** The accounts these lookups find (the authority content picker reads the query its own way). */
export async function searchAccountLookups(searcher: Searcher, lookups: readonly AccountLookup[], options: { ip?: string; now?: Date } = {}): Promise<AccountHit[]> {
  const hits = new Map<string, AccountHit>();
  const results = await Promise.all(lookups.map(async (lookup) => ({ lookup, users: await run(lookup) })));
  for (const { lookup, users } of results) {
    for (const user of users) {
      const hit = hits.get(user.uid);
      if (hit) {
        if (!hit.matched.includes(lookup.kind)) hit.matched.push(lookup.kind);
        continue;
      }
      hits.set(user.uid, {
        uid: user.uid,
        publicId: user.publicId,
        displayName: user.displayName,
        type: user.type,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        activeListings: user.stats.activeListings,
        matched: [lookup.kind],
      });
    }
    // Identity lookups are journaled: who searched, how, and what came out (never the value typed).
    if (lookup.kind === "email" || lookup.kind === "phone") {
      await audit({
        actorUid: searcher.uid,
        actorRole: searcher.role,
        action: `account.search.${lookup.kind}`,
        target: { type: "user", id: users[0]?.uid ?? "none" },
        automated: false,
        ...(options.ip ? { ip: options.ip } : {}),
        ...(options.now ? { at: options.now } : {}),
      });
    }
  }
  // Exact matches first, then names in alphabetical order.
  return [...hits.values()].sort((a, b) => Number(a.matched.includes("name") && a.matched.length === 1) - Number(b.matched.includes("name") && b.matched.length === 1) || a.displayName.localeCompare(b.displayName, "fr"));
}
