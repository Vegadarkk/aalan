import type { Metadata } from "next";
import { QUOTAS } from "@/config/quotas";
import { Badge } from "@/components/ui/badge";
import { requirePageStaff } from "@/lib/auth/current-user";
import { readQuotas } from "@/lib/quota";
import { formatQuotaAmount, formatQuotaPeriod, formatQuotaShare, formatQuotaValue, QUOTA_LEVEL } from "../../../_lib/quota-format";

// The free-quota board (§2), a technical page: admins only, under Réglages (zone 7 audit P2-6;
// it was the home of every staff member). Amounts rounded, states in words, the degraded mode
// spelled out where it applies.

export const metadata: Metadata = { title: "Quotas" };

export default async function QuotasPage() {
  await requirePageStaff(["admin"]);
  const quotas = await readQuotas();
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 id="quotas-title" className="text-2xl font-semibold">
          Quotas gratuits
        </h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-muted">
          Alerte à 70 %, mode dégradé au seuil indiqué. Les compteurs sont tenus par l&apos;application ; « Pas encore mesuré » : aucun relevé sur la période en cours.
        </p>
      </div>
      {/* Scrolls on its own on a phone (the page keeps its width): focusable and named for the keyboard. */}
      <div role="region" aria-labelledby="quotas-title" tabIndex={0} className="overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-surface-muted text-start text-foreground-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-start font-medium">Service</th>
              <th scope="col" className="px-4 py-2.5 text-start font-medium">Période</th>
              <th scope="col" className="px-4 py-2.5 text-end font-medium">Consommé</th>
              <th scope="col" className="px-4 py-2.5 text-start font-medium">État</th>
            </tr>
          </thead>
          <tbody>
            {quotas.map((status) => {
              const definition = QUOTAS[status.id];
              const level = QUOTA_LEVEL[status.level];
              const share = status.level === "unknown" ? "" : formatQuotaShare(status.ratio);
              return (
                <tr key={status.id} className="border-t border-border align-top">
                  <th scope="row" className="px-4 py-3 text-start font-normal">
                    <span className="block font-medium">{definition.service}</span>
                    <span className="block font-mono text-xs text-foreground-muted">{status.id}</span>
                  </th>
                  <td className="px-4 py-3 text-foreground-muted">{formatQuotaPeriod(status.period, definition.period)}</td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {status.level === "unknown" ? <span className="text-foreground-muted">Limite {formatQuotaValue(definition.unit, status.limit)}</span> : formatQuotaAmount(definition.unit, status.used, status.limit)}
                    {share ? <span className="block text-xs text-foreground-muted">{share}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={level.variant}>{level.label}</Badge>
                    {status.level === "warning" || status.level === "degraded" ? <p className="mt-1.5 max-w-xs text-xs text-foreground-muted">{definition.degradedMode}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
