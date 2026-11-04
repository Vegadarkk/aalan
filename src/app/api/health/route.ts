import { cachedHealthReport } from "@/lib/health";

// Polled by the uptime Worker (§2) outside the VM. 503 when a dependency fails, so the probe
// alerts; no detail beyond check states. Public and unauthenticated (the probe sends no secret to
// production), so the report is cached in process for 5 s (security review D-6): a flood costs
// no Valkey or Meilisearch call beyond one round per process every 5 s.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await cachedHealthReport();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
