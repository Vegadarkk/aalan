import { Ban, FileText, ShieldCheck, Stamp } from "lucide-react";
import { useTranslations } from "next-intl";
import { textLinkClassName } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// « Avant d'envoyer » on /transporteurs (transporteurs/spec.md §8, client disclaimers): the sender's
// own duties (contents and customs), what may be added on arrival, the CMR cap on the carrier's
// liability and the forbidden goods, with the guide's sheet for the official links. Server only.

/** The guide's sheet « Envoyer un colis par transporteur ». */
export const PARCEL_GUIDE_HREF = "/demarches/mre#procedure-mre-colis";

const POINTS = [
  { key: "content", icon: FileText },
  { key: "customs", icon: Stamp },
  { key: "insurance", icon: ShieldCheck },
  { key: "forbidden", icon: Ban },
] as const;

export function BeforeSending({ className }: { className?: string }) {
  const t = useTranslations("CarrierSearch.before");
  return (
    <section aria-labelledby="carrier-before-title" data-testid="carrier-before" className={cn("flex flex-col gap-4 rounded-lg border border-border p-5", className)}>
      <h2 id="carrier-before-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {POINTS.map(({ key, icon: Icon }) => (
          <li key={key} className="flex items-start gap-3 text-sm text-pretty">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-structure dark:text-gold-300" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <Link href={PARCEL_GUIDE_HREF} prefetch={false} className={cn("self-start text-sm font-medium text-link", textLinkClassName)}>
        {t("guide")}
      </Link>
    </section>
  );
}
