import { UnrecoverableError, type Job } from "bullmq";
import type { UploadStatusResponse } from "@/lib/contracts/media";
import type { ImageClassification } from "@/lib/media/classify";
import { IMAGE_CHECK_JOB, isImageCheckJobData, processImageCheck } from "@/lib/media/image-check";
import { logger } from "@/lib/logging/logger";
import { expireUpload, processUpload } from "@/lib/media/pipeline";
import { isMediaJobData } from "@/lib/media/queue";
import { isListingPhotosJobData, LISTING_PHOTOS_JOB } from "@/lib/media/photo-sync";
import { objectStore } from "@/lib/storage";
import { syncListingPhotos, type ListingPhotosResult } from "./listing-photos";

// Processor of the "media" queue (D12, concurrency 1): one upload per job. Media failures end as
// rejections inside the pipeline; infrastructure failures throw, BullMQ retries them, and the last
// failed attempt expires the upload so the wizard stops waiting and offers a retry. The queue also
// carries "sync-listing-photos" {listingId} (audit C-3): a listing's photos moved to the bucket its
// state calls for (./listing-photos.ts), one at a time with the pipeline (bounded memory), and
// "check-image" {key}: the scores of a profile photo or shop logo the web is waiting for
// (src/lib/media/image-check.ts), since the ONNX models live in this image only.

export async function processMediaJob(job: Pick<Job, "id" | "name" | "data">): Promise<UploadStatusResponse | ListingPhotosResult | ImageClassification | null> {
  if (job.name === IMAGE_CHECK_JOB) {
    if (!isImageCheckJobData(job.data)) throw new UnrecoverableError(`invalid image check job ${job.id ?? ""}`);
    return processImageCheck(job.data, { store: objectStore() });
  }
  if (job.name === LISTING_PHOTOS_JOB) {
    if (!isListingPhotosJobData(job.data)) throw new UnrecoverableError(`invalid listing photos job ${job.id ?? ""}`);
    return syncListingPhotos(job.data.listingId);
  }
  // Payloads are ours, but a malformed one must not burn three attempts.
  if (!isMediaJobData(job.data)) throw new UnrecoverableError(`invalid media job ${job.id ?? ""}`);
  return processUpload(job.data.uploadId);
}

/**
 * "failed" listener: after the final attempt the upload is expired (objects deleted best effort).
 * A listing photos job has nothing to expire: its final failure is only reported (true).
 */
export async function onMediaJobFailed(job: Pick<Job, "name" | "data" | "attemptsMade" | "opts"> | undefined, error: Error): Promise<boolean> {
  if (!job) return false;
  const final = job.attemptsMade >= (job.opts.attempts ?? 1) || error instanceof UnrecoverableError;
  if (job.name === LISTING_PHOTOS_JOB || job.name === IMAGE_CHECK_JOB) return final;
  if (!isMediaJobData(job.data) || !final) return false;
  try {
    await expireUpload(job.data.uploadId);
    return true;
  } catch (cause) {
    // Still `processing`: purge-quarantine expires it after 24 h.
    logger.error({ uploadId: job.data.uploadId, err: (cause as Error).message }, "upload not expired after the last attempt");
    return false;
  }
}
