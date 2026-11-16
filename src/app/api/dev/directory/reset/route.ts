import { serverEnv } from "@/lib/env";
import { notFound } from "@/lib/http/errors";
import { apiRoute, json } from "@/lib/http/route";
import { resetDirectoryShopsCache } from "@/lib/pro/directory";

// Development only (APP_ENV=dev): forgets the process-wide copy of the shop directory, so shops
// written straight into the emulator are listed at once (e2e: seed, then POST here). Deployed
// environments refresh it within 5 minutes, or at once when a shop is verified or revalidated.
export const dynamic = "force-dynamic";

export const POST = apiRoute(async () => {
  if (serverEnv().APP_ENV !== "dev") throw notFound();
  resetDirectoryShopsCache();
  return json({ ok: true });
});
