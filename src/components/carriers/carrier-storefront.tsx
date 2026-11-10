import { ArrowLeftRight, Ban, CalendarClock, House, IdCard, Package, Scale, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CARRIER_ITEM_IDS, CARRIER_SURCHARGES, EU_ZONE_COUNTRIES, euZoneById, type CarrierItem, type CarrierRestricted, type CarrierSurcharge, type EuZoneCountry } from "@/config/carriers";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import type { CarrierSettings } from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";

// Blocks of a Europe–Morocco carrier's storefront (transporteurs/spec.md §3), server-rendered: the
// carrier card (licence « déclarée », directions, transit, vehicle, collection and delivery) and its
// price list (per kg with weight bands, minimum, volumetric weight, flat prices of items,
// surcharges), the areas it serves and the goods it refuses. Everything is the carrier's
// declaration: the carrier weighs the parcels and stays bound by the price list it published.

/** Zones listed by name per country before « +N » (a carrier may serve a whole country). */
const ZONES_SHOWN = 8;

export function CarrierCard({ carrier, className }: { carrier: CarrierSettings; className?: string }) {
  const t = useTranslations("Storefront.carrier");
  const labels = useTranslations("Carriers");
  const modes = (value: { depot: boolean; home: boolean }, kind: "pickup" | "delivery") => [value.depot ? t(`${kind}Depot`) : null, value.home ? t(`${kind}Home`) : null].filter(Boolean).join(" · ");
  const vehicle = [labels(`vehicles.${carrier.vehicle.kind}`), carrier.vehicle.volumeM3 ? t("volume", { m3: carrier.vehicle.volumeM3 }) : null, carrier.vehicle.payloadKg ? t("payload", { kg: carrier.vehicle.payloadKg }) : null].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="carrier-card" data-testid="carrier-card" className={cn("flex flex-col gap-4 rounded-lg border border-border bg-surface p-5", className)}>
      <h2 id="carrier-card" className="sr-only">
        {t("cardTitle")}
      </h2>
      <div className="flex items-start gap-3">
        <Badge icon={IdCard} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium">
            {t("licence")}{" "}
            <span dir="ltr" data-testid="carrier-licence" className="tabular-nums">
              {carrier.licenceRef}
            </span>
          </p>
          <p className="text-sm text-foreground-muted text-pretty">{t("licenceDeclared")}</p>
        </div>
      </div>
      <Row icon={ArrowLeftRight} title={t("directions")}>
        {carrier.directions.map((direction) => labels(`directions.${direction}`)).join(" · ")}
      </Row>
      <Row icon={CalendarClock} title={t("transit")}>
        {carrier.transitDays.min === carrier.transitDays.max ? t("transitDays", { count: carrier.transitDays.max }) : t("transitRange", { min: carrier.transitDays.min, max: carrier.transitDays.max })}
      </Row>
      <Row icon={Warehouse} title={t("pickup")}>
        {modes(carrier.pickup, "pickup")}
      </Row>
      <Row icon={House} title={t("delivery")}>
        {modes(carrier.delivery, "delivery")}
      </Row>
      <Row icon={Truck} title={t("vehicle")}>
        {vehicle}
      </Row>
    </section>
  );
}

export function CarrierPrices({ carrier, updatedAt, locale }: { carrier: CarrierSettings; updatedAt: string | null; locale: Locale }) {
  const t = useTranslations("Storefront.carrier");
  const labels = useTranslations("Carriers");
  const format = useFormatter();
  const { tariff } = carrier;
  const money = (minor: number) => format.number(minor / 100, { style: "currency", currency: tariff.currency });
  const lowest = Math.min(tariff.perKg, ...tariff.bands.map((band) => band.perKg));
  const refusedItems = carrier.refused.filter((good) => (CARRIER_ITEM_IDS as readonly string[]).includes(good));
  const refusedGoods = carrier.refused.filter((good) => !refusedItems.includes(good));
  const zones = EU_ZONE_COUNTRIES.map((country) => ({ country, names: carrier.euZones.filter((id) => id.startsWith(`${country}-`)).map((id) => euZoneById(id)?.name ?? id) })).filter((entry) => entry.names.length > 0);
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });
  return (
    <section aria-labelledby="carrier-prices" data-testid="carrier-prices" className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-5 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h2 id="carrier-prices" className="text-xl font-semibold">
            {t("pricesTitle")}
          </h2>
          {updatedAt ? <p className="text-sm text-foreground-muted">{t("updatedOn", { date: format.dateTime(new Date(updatedAt), { dateStyle: "long" }) })}</p> : null}
        </div>
        <p className="flex items-baseline gap-1.5" data-testid="carrier-from">
          <span className="text-sm text-foreground-muted">{t("from")}</span>
          <span className="text-2xl font-semibold tabular-nums">{money(lowest)}</span>
          <span className="text-sm text-foreground-muted">{t("perKgUnit")}</span>
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block icon={Scale} title={t("weightTitle")}>
          <ul className="flex flex-col gap-1.5 text-sm">
            <Line label={tariff.bands.length ? t("bandUpTo", { kg: tariff.bands[0]!.fromKg }) : t("perKg")} value={`${money(tariff.perKg)} ${t("perKgUnit")}`} />
            {tariff.bands.map((band) => (
              <Line key={band.fromKg} label={t("bandFrom", { kg: band.fromKg })} value={`${money(band.perKg)} ${t("perKgUnit")}`} />
            ))}
            {tariff.minimum > 0 ? <Line label={t("minimum")} value={money(tariff.minimum)} /> : null}
          </ul>
          <p className="text-sm text-foreground-muted text-pretty">{tariff.volumetricKgPerM3 ? t("volumetric", { kg: tariff.volumetricKgPerM3 }) : t("realWeight")}</p>
        </Block>

        <Block icon={Package} title={t("itemsTitle")}>
          {tariff.items.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {tariff.items.map((entry) => (
                <Line key={entry.item} label={labels(`items.${entry.item}`)} value={money(entry.price)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">{t("itemsNone")}</p>
          )}
          <p className="text-sm text-foreground-muted text-pretty">{t("itemsOther")}</p>
        </Block>

        {tariff.surcharges.length > 0 ? (
          <Block icon={Truck} title={t("surchargesTitle")}>
            <ul className="flex flex-col gap-1.5 text-sm">
              {tariff.surcharges.map((entry) => (
                <Line key={entry.kind} label={labels(`surcharges.${entry.kind as CarrierSurcharge}`)} value={CARRIER_SURCHARGES[entry.kind] === "percent" ? t(entry.kind === "insurance" ? "insuranceValue" : "percentValue", { percent: entry.value }) : money(entry.value)} />
              ))}
            </ul>
          </Block>
        ) : null}

        <Block icon={ArrowLeftRight} title={t("areasTitle")}>
          <dl className="flex flex-col gap-2 text-sm">
            {zones.map(({ country, names }) => (
              <div key={country} className="flex flex-col gap-0.5">
                <dt className="font-medium">{regionNames.of(country as EuZoneCountry) ?? country}</dt>
                <dd className="text-foreground-muted text-pretty">{names.length > ZONES_SHOWN ? t("zonesMore", { names: names.slice(0, ZONES_SHOWN).join(", "), count: names.length - ZONES_SHOWN }) : names.join(", ")}</dd>
              </div>
            ))}
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium">{t("morocco")}</dt>
              <dd className="text-foreground-muted text-pretty">
                {carrier.maCities
                  .map((slug) => {
                    const city = cityBySlug(slug);
                    return city ? cityName(city, locale) : slug;
                  })
                  .join(", ")}
              </dd>
            </div>
          </dl>
        </Block>

        {carrier.refused.length > 0 || carrier.note ? (
          <Block icon={Ban} title={t("refusedTitle")}>
            {carrier.refused.length > 0 ? (
              <p className="text-sm text-pretty" data-testid="carrier-refused">
                {[...refusedItems.map((item) => labels(`items.${item as CarrierItem}`)), ...refusedGoods.map((good) => labels(`restricted.${good as CarrierRestricted}`))].join(", ")}
              </p>
            ) : null}
            {carrier.note ? (
              <p dir="auto" className="text-sm whitespace-pre-line text-foreground-muted">
                {carrier.note}
              </p>
            ) : null}
          </Block>
        ) : null}
      </div>

      <p className="rounded-md bg-surface-muted p-3 text-sm text-foreground-muted text-pretty">{t("disclaimer")}</p>
    </section>
  );
}

function Block({ icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Badge icon={icon} />
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-dashed border-border/70 pb-1.5 last:border-0">
      <span>{label}</span>
      <span className="shrink-0 font-medium tabular-nums">{value}</span>
    </li>
  );
}

function Badge({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-brand text-structure dark:text-gold-300">
      <Icon className="size-[1.125rem]" />
    </span>
  );
}

function Row({ icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Badge icon={icon} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-foreground-muted text-pretty">{children}</p>
      </div>
    </div>
  );
}
