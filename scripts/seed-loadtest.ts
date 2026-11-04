// Load test data set (phase 6, D17; docs/lancement/charge-procedure.md), in staging only: 5 000
// published listings of one fictitious seller in Firestore and in the search index, plus 45 000
// listings in the index only (src/lib/loadtest/data.ts). Run in the worker container (Firestore
// and Meilisearch with the worker's own access):
//
//   docker compose exec worker node dist/worker/seed-loadtest.mjs [--apply]            seed
//   docker compose exec worker node dist/worker/seed-loadtest.mjs --remove [--apply]   remove
//   ... --index-only [--remove] [--apply]   the 50 000 index documents only (search-only test:
//   no Firestore write, so no daily quota and no night job reads them; remove the same day)
//
// Dry run by default: prints the counts. Writes: 5 001 Firestore documents (a quarter of Spark's
// daily writes), the same again to remove them; the index takes 50 000 documents in batches of 1 000.
// Removal deletes by id (no read). Refused outside APP_ENV=staging.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { COLLECTIONS } from "@/lib/db/schemas";
import { serverEnv } from "@/lib/env";
import { db, isFirebaseConfigured } from "@/lib/firebase/admin";
import { LOADTEST_INDEX_ONLY, LOADTEST_LISTINGS, LOADTEST_SELLER_UID, loadtestIds, loadtestListing, loadtestSeller } from "@/lib/loadtest/data";
import { consume } from "@/lib/quota";
import { toSearchDocument } from "@/lib/search/document";
import { searchEngine } from "@/lib/search/engine";
import type { SearchDocument, SearchEngine } from "@/lib/search/types";
import { closeValkey } from "@/lib/valkey/clients";

const FIRESTORE_BATCH = 500;
const INDEX_BATCH = 1_000;

export interface SeedArgs {
  remove: boolean;
  apply: boolean;
  /** The index documents only (search-only load test, audit lot 7). */
  indexOnly: boolean;
}

export function parseSeedCli(argv: readonly string[]): SeedArgs {
  const { values } = parseArgs({ args: [...argv], options: { remove: { type: "boolean", default: false }, apply: { type: "boolean", default: false }, "index-only": { type: "boolean", default: false } }, strict: true });
  return { remove: values.remove === true, apply: values.apply === true, indexOnly: values["index-only"] === true };
}

/** What the seed writes to: Firestore batches and the search engine. */
export interface SeedTarget {
  write(operations: { path: string; data: Record<string, unknown> | null }[]): Promise<void>;
  engine: Pick<SearchEngine, "upsert" | "remove">;
  log(line: string): void;
}

async function inBatches<T>(items: readonly T[], size: number, run: (batch: T[]) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) await run(items.slice(start, start + size));
}

/** Seeds the data set: Firestore first (the pages need it), then the index. Returns the counts written. */
export async function seed(target: SeedTarget, now: Date, { indexOnly = false }: { indexOnly?: boolean } = {}): Promise<{ documents: number; indexed: number }> {
  const listings = Array.from({ length: LOADTEST_LISTINGS }, (_, n) => loadtestListing("zz", n, now));
  const operations = indexOnly
    ? []
    : [
        { path: `${COLLECTIONS.users}/${LOADTEST_SELLER_UID}`, data: loadtestSeller(now) as unknown as Record<string, unknown> },
        ...listings.map(({ id, ...doc }) => ({ path: `${COLLECTIONS.listings}/${id}`, data: doc as unknown as Record<string, unknown> })),
      ];
  await inBatches(operations, FIRESTORE_BATCH, (batch) => target.write(batch));
  target.log(`Firestore: ${operations.length} documents written`);

  let indexed = 0;
  const all = [...listings, ...Array.from({ length: LOADTEST_INDEX_ONLY }, (_, n) => loadtestListing("zy", n, now))];
  await inBatches(all, INDEX_BATCH, async (batch) => {
    const documents = batch.map((listing) => toSearchDocument(listing, now)).filter((document): document is SearchDocument => document !== null);
    await target.engine.upsert(documents);
    indexed += documents.length;
  });
  target.log(`Index: ${indexed} documents`);
  return { documents: operations.length, indexed };
}

/** Removes the data set by id: the index first (no search result points at a deleted listing), then Firestore. */
export async function removeSeed(target: SeedTarget, { indexOnly = false }: { indexOnly?: boolean } = {}): Promise<{ documents: number; unindexed: number }> {
  const { firestore, indexOnly: indexed } = loadtestIds();
  const ids = [...firestore, ...indexed];
  await inBatches(ids, INDEX_BATCH, (batch) => target.engine.remove(batch));
  target.log(`Index: ${ids.length} ids removed`);
  const operations = indexOnly ? [] : [...firestore.map((id) => ({ path: `${COLLECTIONS.listings}/${id}`, data: null })), { path: `${COLLECTIONS.users}/${LOADTEST_SELLER_UID}`, data: null }];
  await inBatches(operations, FIRESTORE_BATCH, (batch) => target.write(batch));
  target.log(`Firestore: ${operations.length} documents deleted`);
  return { documents: operations.length, unindexed: ids.length };
}

async function main(): Promise<void> {
  const args = parseSeedCli(process.argv.slice(2));
  const env = serverEnv();
  if (env.APP_ENV !== "staging") throw new Error(`the load test data set goes to staging only (APP_ENV=${env.APP_ENV})`);
  if (!env.MEILI_URL || !env.MEILI_INDEX_KEY) throw new Error("MEILI_URL and MEILI_INDEX_KEY are required (run it in the worker container)");
  if (!args.indexOnly && !isFirebaseConfigured()) throw new Error("Firebase is not configured");
  const total = args.indexOnly ? 0 : LOADTEST_LISTINGS + 1;
  if (!args.apply) {
    console.log(args.remove ? `Would remove ${LOADTEST_LISTINGS + LOADTEST_INDEX_ONLY} index documents and ${total} Firestore documents.` : `Would write ${total} Firestore documents and index ${LOADTEST_LISTINGS + LOADTEST_INDEX_ONLY}.`);
    console.log(`Dry run: nothing written. Add --apply.`);
    return;
  }
  const target: SeedTarget = {
    async write(operations) {
      const batch = db().batch();
      for (const { path, data } of operations) {
        if (data === null) batch.delete(db().doc(path));
        else batch.set(db().doc(path), data);
      }
      await batch.commit();
      await consume(operations.some(({ data }) => data === null) ? "firestore.deletes" : "firestore.writes", operations.length);
    },
    engine: searchEngine(),
    log: (line) => console.log(line),
  };
  if (args.remove) await removeSeed(target, { indexOnly: args.indexOnly });
  else await seed(target, new Date(), { indexOnly: args.indexOnly });
}

const self = fileURLToPath(import.meta.url);
if (/[\\/]seed-loadtest\.(?:ts|mjs)$/.test(self) && process.argv[1] !== undefined && realpathSync(process.argv[1]) === self) {
  main()
    .then(async () => {
      await closeValkey().catch(() => undefined);
      process.exit(0);
    })
    .catch(async (error: unknown) => {
      console.error(`seed-loadtest: ${(error as Error).message}`);
      await closeValkey().catch(() => undefined);
      process.exit(1);
    });
}
