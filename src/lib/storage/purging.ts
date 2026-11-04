import "server-only";
import { logger } from "@/lib/logging/logger";
import { captureServerException } from "@/lib/observability/capture";
import type { BucketRole, GetOptions, ObjectHead, ObjectStore, PresignedPut, PresignPutInput, PutOptions } from "./types";

// Edge cache of deleted media (audit A4-04): every DELETE in the public media bucket, whichever
// path issues it (owner deletion, pipeline rejection, move of a removed, refused or hidden
// listing's photos to the private bucket, retention purge, replaced Pro logo), asks for that URL to leave the CDN once the
// object is gone. A failed request is logged and reported, never thrown: the deletion stands, and
// the caller's own retries (deletions are idempotent) must not depend on the CDN.

export type MediaDeletedHook = (key: string) => Promise<void>;

export class CdnPurgingObjectStore implements ObjectStore {
  readonly name: string;

  constructor(
    private readonly inner: ObjectStore,
    private readonly onMediaDeleted: MediaDeletedHook,
  ) {
    this.name = inner.name;
  }

  presignPut(input: PresignPutInput): Promise<PresignedPut> {
    return this.inner.presignPut(input);
  }

  head(bucket: BucketRole, key: string): Promise<ObjectHead | null> {
    return this.inner.head(bucket, key);
  }

  get(bucket: BucketRole, key: string, options?: GetOptions): Promise<Buffer | null> {
    return this.inner.get(bucket, key, options);
  }

  put(bucket: BucketRole, key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    return this.inner.put(bucket, key, body, options);
  }

  async delete(bucket: BucketRole, key: string): Promise<void> {
    await this.inner.delete(bucket, key);
    if (bucket !== "media") return;
    try {
      await this.onMediaDeleted(key);
    } catch (error) {
      // The key is an object id (no personal data); the edge may serve the old copy until it expires.
      logger.error({ key, err: (error as Error).message }, "deleted media not purged from the CDN");
      captureServerException(error, { operation: "cdn-purge", key });
    }
  }
}
