import "server-only";
import { CdnPurgeError, type CdnPurger } from "./types";

// Cloudflare zone cache purge by URL ("single-file purge"):
// POST https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache {"files": [...]}, with a
// token holding only Zone > Cache Purge on the media host's zone (CF_MEDIA_PURGE_TOKEN). Limits
// (developers.cloudflare.com/cache/how-to/purge-cache, Free plan, per account): 100 URLs per
// request, 800 URLs per second. The answer carries `success` and `errors[].code`; only the codes
// are kept (an error message may quote the request).

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
/** Most URLs one purge request may carry (Free plan). */
export const PURGE_BATCH = 100;
export const PURGE_TIMEOUT_MS = 10_000;

const ZONE_ID = /^[0-9a-f]{32}$/;

export interface CloudflarePurgerConfig {
  zoneId: string;
  token: string;
  /** fetch implementation (tests inject a mock). */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface PurgeAnswer {
  success?: unknown;
  errors?: unknown;
}

function errorCodes(answer: PurgeAnswer | null): number[] {
  if (!answer || !Array.isArray(answer.errors)) return [];
  return answer.errors.map((error: unknown) => (typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined)).filter((code): code is number => typeof code === "number");
}

export class CloudflareCdnPurger implements CdnPurger {
  readonly name = "cloudflare";
  private readonly zoneId: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: CloudflarePurgerConfig) {
    if (!ZONE_ID.test(config.zoneId)) throw new Error("Cloudflare zone id must be 32 hexadecimal characters");
    if (!config.token) throw new Error("Cloudflare purge token is empty");
    this.zoneId = config.zoneId;
    this.token = config.token;
    this.fetchImpl = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? PURGE_TIMEOUT_MS;
  }

  async purgeUrls(urls: readonly string[]): Promise<void> {
    const unique = [...new Set(urls)];
    for (const url of unique) if (!/^https:\/\/[^\s/]+\/\S*$/.test(url)) throw new CdnPurgeError(0, [], "only absolute https URLs can be purged");
    for (let start = 0; start < unique.length; start += PURGE_BATCH) await this.purgeBatch(unique.slice(start, start + PURGE_BATCH));
  }

  private async purgeBatch(files: string[]): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${CLOUDFLARE_API}/zones/${this.zoneId}/purge_cache`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ files }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CdnPurgeError(0, [], (error as Error).name === "TimeoutError" ? "no answer in time" : "network error");
    }
    let answer: PurgeAnswer | null = null;
    try {
      answer = (await response.json()) as PurgeAnswer;
    } catch {
      // Not JSON (a proxy's error page): the status decides.
    }
    if (!response.ok || answer?.success !== true) throw new CdnPurgeError(response.status, errorCodes(answer));
  }
}
