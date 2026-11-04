import "server-only";
import { requestIdentity } from "./keys";
import { enforceLimit } from "./limiter";

// Per-IP ceiling of the provider webhooks (security review D-1). Each webhook route calls it
// first, before the body is read: a sender of large junk-signed bodies is refused (429) before
// any buffering or HMAC. "webhook.ip" is open, so a Valkey outage lets every provider event in.

/** Throws 429 (Retry-After) once this IP bucket is over `webhook.ip`. */
export async function enforceWebhookLimit(request: Request): Promise<void> {
  await enforceLimit("webhook.ip", requestIdentity(request.headers).ipBucket);
}
