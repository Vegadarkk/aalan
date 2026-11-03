import type { Locale } from "@/config/site";
import { useNumbersTranslations } from "@/i18n/numbers";
import type { RatingSummary } from "@/lib/contracts/reviews";
import { cn } from "@/lib/utils";
import { formatAverage } from "./seller-reviews";
import { Stars } from "./stars";

// "★★★★½ 4,6 · 12 avis" next to a seller's name, down to the storefront's reviews block (`#avis`),
// on /profil itself or from the listing page's seller card. Nothing while there is no review.

export function RatingLink({ rating, locale, href = "#avis", tone = "default", className }: { rating: RatingSummary; locale: Locale; href?: string; tone?: "default" | "onStructure"; className?: string }) {
  const t = useNumbersTranslations("Reviews");
  if (rating.count === 0 || rating.average === null) return null;
  const average = formatAverage(rating.average, locale);
  return (
    <a
      href={href}
      data-testid="rating-link"
      className={cn(
        // A 44 px tap target without moving the line (UX audit of the Pro shops, B9).
        "relative inline-flex min-h-6 items-center gap-1.5 rounded-sm text-sm after:absolute after:inset-x-0 after:-inset-y-2.5",
        // On the storefront's green band the muted greys fell to 1.4:1 (UX audit of the Pro shops, B1).
        tone === "onStructure" ? "text-structure-foreground/85 hover:text-structure-foreground" : "text-foreground-muted hover:text-foreground",
        className,
      )}
    >
      <Stars value={rating.average} />
      <span className={cn("font-semibold tabular-nums", tone === "onStructure" ? "text-structure-foreground" : "text-foreground")}>{average}</span>
      <span className="sr-only">{t("average", { average })}</span>
      <span aria-hidden="true">·</span>
      <span className="underline-offset-4 hover:underline">{t("count", { count: rating.count })}</span>
    </a>
  );
}
