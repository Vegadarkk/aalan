import "server-only";
import { CdnPurgeError, type CdnPurger } from "./types";

/** Records purged URLs (tests); `failNext` makes the next calls throw like a refused request. */
export class MemoryCdnPurger implements CdnPurger {
  readonly name = "memory";
  readonly purged: string[] = [];
  failNext = 0;

  async purgeUrls(urls: readonly string[]): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new CdnPurgeError(503);
    }
    this.purged.push(...urls);
  }
}
