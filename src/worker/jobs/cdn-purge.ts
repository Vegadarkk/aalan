import { UnrecoverableError, type Job } from "bullmq";
import { alert } from "@/lib/alert";
import { CdnPurgeError, cdnPurger, mediaPurgeUrls, type CdnPurger } from "@/lib/cdn";
import { cdnPurgeJobSchema } from "@/lib/cdn/queue";
import { logger } from "@/lib/logging/logger";

// Processor of the "cdn" queue (audit A4-04, concurrency 1): one job per deleted media object,
// purged from the Cloudflare edge by URL. A refused or unanswered request throws and BullMQ retries
// (src/lib/cdn/queue.ts: 10 attempts over about 8.5 h); a malformed request cannot succeed and
// stops at once. The final failure alerts: that photo may stay cached until its max-age.

export interface CdnPurgeDeps {
  purger?: CdnPurger | null;
  mediaBaseUrl?: string;
}

export async function processCdnPurgeJob(job: Pick<Job, "id" | "data">, deps: CdnPurgeDeps = {}): Promise<number> {
  const data = cdnPurgeJobSchema.safeParse(job.data);
  if (!data.success) throw new UnrecoverableError(`invalid CDN purge job ${job.id ?? ""}`);
  const purger = deps.purger === undefined ? cdnPurger() : deps.purger;
  const urls = deps.mediaBaseUrl === undefined ? mediaPurgeUrls(data.data.keys) : mediaPurgeUrls(data.data.keys, { MEDIA_BASE_URL: deps.mediaBaseUrl });
  if (!purger || !urls) {
    // The token or the media host went away after the job was queued: nothing can purge it.
    logger.warn({ job: job.id }, "CDN purge not configured: job dropped");
    return 0;
  }
  try {
    await purger.purgeUrls(urls);
  } catch (error) {
    if (error instanceof CdnPurgeError && error.permanent) throw new UnrecoverableError(error.message);
    throw error;
  }
  return urls.length;
}

/** "failed" listener: true after the final attempt (alerted; the caller reports it to Sentry). */
export async function onCdnPurgeJobFailed(job: Pick<Job, "data" | "attemptsMade" | "opts"> | undefined, error: Error): Promise<boolean> {
  const final = !job || job.attemptsMade >= (job.opts.attempts ?? 1) || error instanceof UnrecoverableError;
  if (!final) return false;
  const keys = cdnPurgeJobSchema.safeParse(job?.data).data?.keys ?? [];
  await alert({
    severity: "P2",
    title: "Purge du cache CDN en échec",
    body: `${keys.length || "Des"} photo(s) supprimée(s) peuvent encore être servies par le cache Cloudflare (${error.message.slice(0, 200)}). Vérifier le jeton CF_MEDIA_PURGE_TOKEN, puis purger à la main : ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "…" : ""}`,
  }).catch((cause: unknown) => logger.error({ err: (cause as Error).message }, "CDN purge alert not sent"));
  return true;
}
