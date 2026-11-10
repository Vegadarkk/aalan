import type { ReactNode } from "react";
import { ArrowRight, CalendarClock, Package, Truck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { textLinkClassName } from "@/components/ui/text-link";
import { euZoneById, type CarrierCurrency, type CarrierSpace } from "@/config/carriers";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import type { PublicDeparture } from "@/lib/listings/public";
import { cn } from "@/lib/utils";

// A carrier's departure on its listing page (transporteurs/spec.md §3, §5): the price from the
// carrier's price list (a departure has none of its own), the dates, the room left and the places
// of the tour, in the page's language. Server-rendered with the page.

/** Places named per side before « +N ». */
const PLACES_SHOWN = 12;

const SPACE_VARIANTS: Record<CarrierSpace, "success" | "neutral" | "warning" | "danger"> = { lots: "success", some: "neutral", almost_full: "warning", full: "danger" };

export function DepartureFacts({ departure, from, pricesHref, compareHref = null, locale, className }: { departure: PublicDeparture; from: { perKg: number; currency: CarrierCurrency } | null; pricesHref: string | null; compareHref?: string | null; locale: Locale; className?: string }) {
  const t = useTranslations("ListingPage.departure");
  const labels = useTranslations("Carriers");
  const format = useFormatter();
  const day = (value: string, weekday = false) => format.dateTime(new Date(`${value}T12:00:00Z`), { ...(weekday ? { weekday: "long" as const } : {}), day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const zones = departure.euZones.map((id) => euZoneById(id)?.name ?? id);
  const cities = departure.maCities.map((slug) => {
    const city = cityBySlug(slug);
    return city ? cityName(city, locale) : slug;
  });
  const toMorocco = departure.direction === "eu_ma";
  const list = (names: string[]) => (names.length > PLACES_SHOWN ? t("more", { names: names.slice(0, PLACES_SHOWN).join(", "), count: names.length - PLACES_SHOWN }) : names.join(", "));
  return (
    <section aria-label={t("label")} data-testid="departure-facts" className={cn("flex flex-col gap-4 rounded-lg border border-border bg-surface-brand p-4 sm:p-5", className)}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="departure-from">
        {from ? (
          <>
            <span className="text-sm text-foreground-muted">{t("from")}</span>
            <span className="text-2xl font-semibold tabular-nums">{format.number(from.perKg / 100, { style: "currency", currency: from.currency })}</span>
            <span className="text-sm text-foreground-muted">{t("perKg")}</span>
          </>
        ) : (
          <span className="font-medium">{t("priceList")}</span>
        )}
        {pricesHref ? (
          <a href={pricesHref} className={cn("ms-auto text-sm font-medium text-link", textLinkClassName)}>
            {t("seePrices")}
          </a>
        ) : null}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SPACE_VARIANTS[departure.space]} data-testid="departure-space-badge">
          <Package aria-hidden="true" className="size-3.5" />
          {labels(`spaces.${departure.space}`)}
          {departure.spaceKg && departure.space !== "full" ? ` · ${t("kgLeft", { kg: departure.spaceKg })}` : null}
        </Badge>
        <span className="text-xs text-foreground-muted">{t("spaceUpdated", { date: format.dateTime(new Date(departure.spaceUpdatedAt), { day: "numeric", month: "long" }) })}</span>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Fact icon={<CalendarClock aria-hidden="true" className="size-4" />} term={t("departOn")}>
          <span className="first-letter:uppercase">{day(departure.departOn, true)}</span>
        </Fact>
        <Fact icon={<CalendarClock aria-hidden="true" className="size-4" />} term={t("depositBy")}>
          {day(departure.depositBy)}
        </Fact>
        <Fact icon={<Truck aria-hidden="true" className="size-4" />} term={t("arrival")}>
          {departure.arriveFrom === departure.arriveTo ? day(departure.arriveFrom) : t("range", { from: day(departure.arriveFrom), to: day(departure.arriveTo) })}
        </Fact>
        <Fact icon={<ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />} term={t("direction")}>
          {labels(`directions.${departure.direction}`)}
        </Fact>
      </dl>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium">{toMorocco ? t("collectEurope") : t("collectMorocco")}</dt>
          <dd className="text-foreground-muted text-pretty">{list(toMorocco ? zones : cities)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium">{toMorocco ? t("deliverMorocco") : t("deliverEurope")}</dt>
          <dd className="text-foreground-muted text-pretty">{list(toMorocco ? cities : zones)}</dd>
        </div>
      </dl>
      <p className="text-xs text-foreground-muted text-pretty">{t("notice")}</p>
      {compareHref ? (
        <Link href={compareHref} data-testid="departure-compare" className={cn("self-start text-sm font-medium text-link", textLinkClassName)}>
          {t("compare")}
        </Link>
      ) : null}
    </section>
  );
}

function Fact({ icon, term, children }: { icon: ReactNode; term: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-structure dark:text-gold-300">{icon}</span>
      <div className="flex flex-col gap-0.5">
        <dt className="text-foreground-muted">{term}</dt>
        <dd className="font-medium">{children}</dd>
      </div>
    </div>
  );
}
