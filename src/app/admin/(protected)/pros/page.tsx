import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { cityBySlug, cityName } from "@/config/regions";
import { requirePageStaff } from "@/lib/auth/current-user";
import { rentalCheckQueue } from "@/lib/pro/rental-check";
import { proQueue } from "@/lib/pro/review";
import { LEGAL_FORM_LABEL, RENTAL_CHECK_ISSUE_LABEL, formatIce } from "../../_components/pro-labels";
import { formatMorocco } from "../../_lib/moderation-format";

// KYBC queue of the back office (phase 7 design §4): submitted Pro applications, oldest first;
// then the car rental licence documents the AI check left in doubt (decision 5). Moderators and admins.

export const metadata: Metadata = { title: "Comptes Pro" };

export default async function ProQueuePage() {
  await requirePageStaff(["moderator", "admin"]);
  const [queue, checks] = await Promise.all([proQueue(), rentalCheckQueue()]);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Demandes de compte Pro</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-muted">
          Demandes à vérifier, les plus anciennes en premier. Vérifiez les identifiants au registre et les justificatifs, appelez le numéro du demandeur
          s’il n’est pas encore vérifié, puis validez ou refusez avec un motif.
        </p>
      </div>
      {queue.items.length === 0 ? (
        <EmptyState title="Aucune demande en attente">Les nouvelles demandes de compte Pro apparaîtront ici.</EmptyState>
      ) : (
        <>
          {/* One column per fact (zone 7 audit P4): shop, city, applicant, ICE, documents, date. The shop name links to the record; the whole row is its target. */}
          <div role="region" aria-labelledby="pro-queue-title" tabIndex={0} className="relative overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <table className="w-full min-w-[52rem] text-sm" data-testid="pro-queue">
              <caption id="pro-queue-title" className="sr-only">
                Demandes de compte Pro, les plus anciennes en premier
              </caption>
              <thead className="bg-surface-muted text-foreground-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">Boutique</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">Ville</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">Demandeur</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">ICE</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-medium">Justificatifs</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-medium">Demandée le</th>
                </tr>
              </thead>
              <tbody>
                {queue.items.map((item) => {
                  const city = cityBySlug(item.citySlug);
                  return (
                    <tr key={item.proId} className="relative border-t border-border align-top transition-colors hover:bg-surface-muted/60">
                      <th scope="row" className="px-4 py-3 text-start font-normal">
                        <Link
                          href={`/pros/${item.proId}`}
                          dir="auto"
                          className="font-semibold text-foreground underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                        >
                          {item.name}
                        </Link>
                        <span className="block text-foreground-muted">{LEGAL_FORM_LABEL[item.legalForm] ?? item.legalForm}</span>
                      </th>
                      <td className="px-4 py-3">{city ? cityName(city, "fr") : <span className="text-foreground-muted">Non indiquée</span>}</td>
                      <td className="px-4 py-3" dir="auto">
                        {item.owner ? item.owner.displayName : <span className="text-foreground-muted">Non disponible</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono whitespace-nowrap tabular-nums" dir="ltr">
                          {formatIce(item.ice)}
                        </span>
                        {item.iceFormatOk ? null : (
                          <Badge variant="warning" className="mt-1 block w-fit">
                            Format à vérifier
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums">{item.pieces > 1 ? `${item.pieces} pièces` : "1 pièce"}</td>
                      <td className="px-4 py-3 text-end whitespace-nowrap text-foreground-muted tabular-nums">{formatMorocco(item.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {queue.hasMore ? <p className="text-sm text-foreground-muted">Seules les {queue.items.length} plus anciennes sont affichées : traitez-les pour voir les suivantes.</p> : null}
        </>
      )}

      <section aria-labelledby="rental-checks" className="flex flex-col gap-3">
        <div>
          <h2 id="rental-checks" className="text-xl font-semibold">
            Agréments de location à contrôler
          </h2>
          <p className="mt-1 max-w-prose text-sm text-foreground-muted">Décisions d’agrément que la lecture IA n’a pas pu confirmer, les plus anciennes en premier.</p>
        </div>
        {checks.items.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun document en attente.</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="rental-check-queue">
            {checks.items.map((item) => (
              <li key={item.proId}>
                <Link
                  href={`/pros/${item.proId}#agrement`}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-semibold" dir="auto">
                      {item.name}
                    </span>
                    <span className="text-sm text-foreground-muted">{item.issues.map((issue) => RENTAL_CHECK_ISSUE_LABEL[issue] ?? issue).join(" · ") || "À contrôler"}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono tabular-nums" dir="ltr">
                      N° {item.agrementRef}
                    </span>
                    <span className="text-foreground-muted">{formatMorocco(item.submittedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {checks.hasMore ? <p className="text-sm text-foreground-muted">Seuls les {checks.items.length} plus anciens sont affichés.</p> : null}
      </section>
    </>
  );
}
