"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAYMENTS_API, type AdminWithdrawalView } from "@/lib/contracts/payments";
import { adminFetch, errorMessage } from "./api-client";

// Withdrawals from credit packs (CGV §6) waiting for their refund: the unspent credits already left
// the buyer's wallet. RevenueCat refunds whole purchases only, so the admin refunds the amount shown
// as a partial refund of the payment in Stripe, then marks it refunded here (Stripe refund id optional).

const MESSAGES: Record<string, string> = { invalid_body: "Identifiant de remboursement Stripe invalide (re_…)." };
const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" });
const day = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Africa/Casablanca" });

/** `nowMs`: the page's render time (the "late" mark: less than 3 days left). */
export function WithdrawalsAdmin({ initial, nowMs }: { initial: AdminWithdrawalView[]; nowMs: number }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [refundIds, setRefundIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markRefunded(orderId: string) {
    setError(null);
    setBusy(orderId);
    const stripeRefundId = refundIds[orderId]?.trim();
    try {
      const next = await adminFetch<AdminWithdrawalView[]>(PAYMENTS_API.adminWithdrawals, { method: "POST", body: { orderId, ...(stripeRefundId ? { stripeRefundId } : {}) }, csrf: true });
      if (next) setItems(next);
      toast.success("Rétractation marquée remboursée");
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, MESSAGES));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="withdrawals-title" className="flex flex-col gap-3">
      <div>
        <h2 id="withdrawals-title" className="text-lg font-semibold">
          Rétractations à rembourser
        </h2>
        <p className="mt-1 max-w-prose text-sm text-foreground-muted">
          Les crédits non utilisés sont déjà retirés. Rembourser le montant indiqué dans Stripe (remboursement partiel du paiement du pack, avant la date limite), puis le marquer ici.
        </p>
      </div>
      {error ? <ErrorBanner title={error} /> : null}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-foreground-muted">Aucune rétractation en attente.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {items.map((item) => {
            const late = new Date(item.refundBy).getTime() - nowMs < 3 * 86_400_000;
            return (
              <li key={item.orderId} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {item.receipt}
                    {item.environment === "SANDBOX" ? <Badge variant="neutral">Test</Badge> : null}
                    <Badge variant={late ? "danger" : "warning"}>Avant le {day.format(new Date(item.refundBy))}</Badge>
                  </span>
                  <span className="text-foreground-muted">
                    Demandée le {dateTime.format(new Date(item.requestedAt))} · {item.removedCredits} crédits retirés · pack {item.packId}
                  </span>
                  <span className="break-all text-foreground-muted">Commande {item.orderId} · compte {item.accountId}</span>
                  <span className="text-base font-semibold tabular-nums">
                    {(item.refundMinor / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {item.currency} à rembourser
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    aria-label={`Identifiant du remboursement Stripe de ${item.receipt}`}
                    placeholder="re_… (facultatif)"
                    value={refundIds[item.orderId] ?? ""}
                    onChange={(event) => setRefundIds((prev) => ({ ...prev, [item.orderId]: event.target.value }))}
                    className="sm:w-56"
                  />
                  <Button type="button" variant="structure" size="sm" loading={busy === item.orderId} onClick={() => void markRefunded(item.orderId)}>
                    Marquer remboursé
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
