import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { SITE_NAME } from "@/config/site";
import { cn } from "@/lib/utils";

// "Renting a vehicle in Morocco" (rental pack, design location-voitures/location-voitures.md §2 and
// §7), on every car rental listing: a visible agency, the written contract (loi 31-08: copy handed,
// Arabic on request), the check-out inspection, no identity paper or blank cheque as a guarantee,
// the licence. The site rents nothing and takes no payment: said last.

const STEPS = ["agency", "contract", "inspection", "guarantee", "licence", "payment"] as const;
// A holiday home's stay (audit L4-12): the host's authorisation (law 80-14), a written
// confirmation, the arrival check, the identity record and tourist tax, no payment on the site.
const STAY_STEPS = ["host", "confirmation", "arrival", "register", "payment"] as const;

export function RentalGuide({ stay = false, className }: { stay?: boolean; className?: string }) {
  const guide = useTranslations("ListingPage.rentalGuide");
  const t = ((key: string, values?: Record<string, string>) => guide((stay ? `home.${key}` : key) as Parameters<typeof guide>[0], values as never)) as typeof guide;
  return (
    <section data-testid="rental-guide" data-stay={stay ? "" : undefined} aria-labelledby="rental-guide-title" className={cn("flex flex-col gap-4 rounded-lg border border-border p-5", className)}>
      <h2 id="rental-guide-title" className="flex items-center gap-2.5 text-lg font-semibold">
        <KeyRound className="size-5 shrink-0 text-structure dark:text-gold-300" aria-hidden="true" />
        {t("title")}
      </h2>
      <ol className="flex flex-col gap-3">
        {(stay ? STAY_STEPS : STEPS).map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-sm text-pretty">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-brand text-xs font-semibold tabular-nums text-structure dark:text-gold-300">
              {index + 1}
            </span>
            <span>{t(`steps.${step}` as "steps.agency", { brand: SITE_NAME })}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-foreground-muted text-pretty">{t("source")}</p>
    </section>
  );
}
