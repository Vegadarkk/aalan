import { createHmac } from "node:crypto";
import { logger } from "@/lib/logging/logger";
import type { Alert, AlertChannel } from "./types";

/**
 * The uptime Worker (workers/uptime-probe) as alert channel: it records each signed alert as an
 * incident for the agents (scripts/incidents.ts), archives it by e-mail through the Resend API
 * with a key of its own that never sits on the VM, and pages the owner on Telegram only when a
 * P0/P1 stays unacknowledged for 2 hours. It answers within 6 s, inside the 8 s timeout below:
 * 204 once recorded; without a record, the e-mail outcome (429 daily cap, 503 e-mail off).
 * TELEGRAM_BOT_TOKEN on the VM (optional since 2 Nov 2026) would add a direct Telegram channel.
 */
export class RelayEmailChannel implements AlertChannel {
  readonly name = "email";

  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(alert: Alert, env: string): Promise<void | "off"> {
    const body = JSON.stringify({ ...alert, env });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", this.secret).update(`${timestamp}.${body}`).digest("hex");
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      // X-Aalan-* is read first by the Worker; the copies under the former name keep an older Worker
      // working until it is redeployed (rebrand plan), then they go.
      headers: {
        "Content-Type": "application/json",
        "X-Aalan-Timestamp": timestamp,
        "X-Aalan-Signature": signature,
        "X-Joutiya-Timestamp": timestamp, // legacy-name: allow
        "X-Joutiya-Signature": signature, // legacy-name: allow
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    // 503: not recorded and the Worker has no e-mail configured (ALERT_EMAIL_TO / RESEND_API_KEY
    // unset): a warning, not a channel failure to retry.
    if (response.status === 503) {
      logger.warn("alert relay: e-mail channel off on the Worker");
      return "off";
    }
    // 204 covers both a sent mail and a repeat of the same title within the hour (Resend idempotency).
    if (!response.ok) throw new Error(`alert relay: HTTP ${response.status}`);
  }
}
