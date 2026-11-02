// Minimal Workers runtime types used by the probe (kept local: no extra dependency).

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; expiration?: number; metadata?: unknown }): Promise<void>;
  list(options: { prefix: string; limit?: number }): Promise<{ keys: { name: string; expiration?: number; metadata?: unknown }[] }>;
}

interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
