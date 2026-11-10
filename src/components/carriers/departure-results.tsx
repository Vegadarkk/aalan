"use client";

import { useId, useState, type ReactNode } from "react";
import { BadgeCheck, Columns3, FileCheck2, Package, Star, Truck, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { textLinkClassName } from "@/components/ui/text-link";
import { useReturnFocus } from "@/components/ui/return-focus";
import { CARRIER_ITEM_IDS, CARRIER_SEARCH, euZoneById, type CarrierCurrency, type CarrierItem, type CarrierRestricted, type CarrierSpace, type CarrierSurcharge } from "@/config/carriers";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import type { DepartureCard } from "@/lib/contracts/carrier-search";
import { cn } from "@/lib/utils";

// The departures found on /transporteurs (transporteurs/spec.md §5): a card per departure, its
// carrier and its estimated price, and the comparator of up to three departures side by side.
// Prices are estimates from the carriers' declared lists: nothing is paid on the site, the carrier
// weighs the parcels before taking them (owner, 2026-11-10).

const SPACE_VARIANTS: Record<CarrierSpace, "success" | "neutral" | "warning" | "danger"> = { lots: "success", some: "neutral", almost_full: "warning", full: "danger" };
/** Places named per side on a card before « +N ». */
const PLACES_SHOWN = 3;

function useMoney() {
  const format = useFormatter();
  return (minor: number, currency: CarrierCurrency) => format.number(minor / 100, { style: "currency", currency });
}

function usePlaces() {
  const locale = useLocale() as Locale;
  return {
    zones: (ids: readonly string[]) => ids.map((id) => euZoneById(id)?.name ?? id),
    cities: (slugs: readonly string[]) =>
      slugs.map((slug) => {
        const city = cityBySlug(slug);
        return city ? cityName(city, locale) : slug;
      }),
  };
}

export function DepartureResults({ cards, basket }: { cards: DepartureCard[]; basket: boolean }) {
  const t = useTranslations("CarrierSearch.results");
  const [chosen, setChosen] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => setChosen((current) => (current.includes(id) ? current.filter((other) => other !== id) : current.length < CARRIER_SEARCH.compareMax ? [...current, id] : current));
  const compared = chosen.map((id) => cards.find((card) => card.id === id)).filter((card): card is DepartureCard => card !== undefined);
  return (
    <>
      <ol className="flex flex-col gap-3" data-testid="carrier-results">
        {cards.map((card) => (
          <li key={card.id}>
            <DepartureRow card={card} basket={basket} compared={chosen.includes(card.id)} canCompare={chosen.length < CARRIER_SEARCH.compareMax} onCompare={() => toggle(card.id)} />
          </li>
        ))}
      </ol>
      {compared.length > 0 ? (
        <div className="sticky bottom-3 z-30 mt-4 flex justify-center px-2" data-testid="carrier-compare-bar">
          <div className="flex w-full max-w-xl items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg shadow-bab-950/15">
            <p className="flex-1 text-sm">{t("compareCount", { count: compared.length, max: CARRIER_SEARCH.compareMax })}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setChosen([])}>
              {t("compareClear")}
            </Button>
            <Button type="button" size="sm" disabled={compared.length < 2} onClick={() => setOpen(true)} data-testid="carrier-compare-open">
              <Columns3 aria-hidden="true" className="size-4" />
              {t("compare")}
            </Button>
          </div>
        </div>
      ) : null}
      <CompareDialog open={open && compared.length >= 2} onOpenChange={setOpen} cards={compared} basket={basket} />
    </>
  );
}

function Stars({ rating }: { rating: DepartureCard["carrier"]["rating"] }) {
  const t = useTranslations("CarrierSearch.results");
  const format = useFormatter();
  if (!rating) return <span className="text-foreground-muted">{t("noReviews")}</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={t("rating", { avg: format.number(rating.avg, { maximumFractionDigits: 1 }), count: rating.count })}>
      <Star aria-hidden="true" className="size-3.5 fill-gold-400 text-gold-500" />
      <span aria-hidden="true" className="font-medium tabular-nums">
        {format.number(rating.avg, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      </span>
      <span aria-hidden="true" className="text-foreground-muted tabular-nums">
        ({rating.count})
      </span>
    </span>
  );
}

function DepartureRow({ card, basket, compared, canCompare, onCompare }: { card: DepartureCard; basket: boolean; compared: boolean; canCompare: boolean; onCompare: () => void }) {
  const t = useTranslations("CarrierSearch.results");
  const labels = useTranslations("Carriers");
  const format = useFormatter();
  const money = useMoney();
  const places = usePlaces();
  const { departure, carrier, estimate } = card;
  const day = new Date(`${departure.departOn}T12:00:00Z`);
  const short = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const toMorocco = departure.direction === "eu_ma";
  const zones = places.zones(departure.euZones);
  const cities = places.cities(departure.maCities);
  const list = (names: string[]) => (names.length > PLACES_SHOWN ? t("more", { names: names.slice(0, PLACES_SHOWN).join(", "), count: names.length - PLACES_SHOWN }) : names.join(", "));
  const [origin, destination] = toMorocco ? [list(zones), list(cities)] : [list(cities), list(zones)];
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} data-testid="carrier-result" className={cn("grid grid-cols-[4.75rem_minmax(0,1fr)] overflow-hidden rounded-lg border bg-surface sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]", compared ? "border-structure ring-2 ring-structure/30" : "border-border")}>
      <div className="flex flex-col items-center justify-center gap-0.5 bg-structure px-2 py-4 text-structure-foreground sm:row-span-1" aria-hidden="true">
        <span className="text-xs first-letter:uppercase">{format.dateTime(day, { weekday: "short", timeZone: "UTC" })}</span>
        <span className="text-3xl leading-none font-semibold tabular-nums">{format.dateTime(day, { day: "numeric", timeZone: "UTC" })}</span>
        <span className="text-xs">{format.dateTime(day, { month: "short", timeZone: "UTC" })}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-2 p-4">
        <h3 id={titleId} className="flex flex-wrap items-baseline gap-x-2 font-semibold text-pretty">
          <span className="sr-only">{t("departOn", { date: format.dateTime(day, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) })}</span>
          <span>{origin}</span>
          <Truck aria-label={t("to")} className="size-4 shrink-0 self-center text-structure rtl:-scale-x-100 dark:text-gold-300" />
          <span>{destination}</span>
        </h3>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Link href={`/boutique/${carrier.segment}`} className={cn("font-medium text-link", textLinkClassName)}>
            {carrier.name}
          </Link>
          <Stars rating={carrier.rating} />
          {carrier.verified ? (
            <span className="inline-flex items-center gap-1 text-foreground-muted">
              <BadgeCheck aria-hidden="true" className="size-3.5 text-structure dark:text-gold-300" />
              {t("verified")}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-foreground-muted">
            <FileCheck2 aria-hidden="true" className="size-3.5" />
            {t("licence")}
          </span>
        </p>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground-muted">
          <div className="flex gap-1.5">
            <dt>{t("depositBy")}</dt>
            <dd className="font-medium text-foreground">{short(departure.depositBy)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>{t("arrival")}</dt>
            <dd className="font-medium text-foreground">{departure.arriveFrom === departure.arriveTo ? short(departure.arriveFrom) : t("range", { from: short(departure.arriveFrom), to: short(departure.arriveTo) })}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={SPACE_VARIANTS[departure.space]}>
            <Package aria-hidden="true" className="size-3.5" />
            {labels(`spaces.${departure.space}`)}
            {departure.spaceKg && departure.space !== "full" ? ` · ${t("kgLeft", { kg: departure.spaceKg })}` : null}
          </Badge>
        </div>
      </div>

      <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-muted/50 px-4 py-3 sm:col-span-1 sm:w-44 sm:flex-col sm:flex-nowrap sm:items-stretch sm:justify-center sm:border-t-0 sm:border-s sm:text-end">
        <div className="flex flex-col sm:items-end" data-testid="carrier-result-price">
          {estimate && estimate.total > 0 ? (
            <>
              <span className="text-xs text-foreground-muted">{t("estimate")}</span>
              <span className="text-2xl font-semibold tabular-nums">{money(estimate.total, estimate.currency)}</span>
              {estimate.onRequest.length > 0 ? <span className="text-xs text-foreground-muted">{t("plusOnRequest")}</span> : null}
            </>
          ) : (
            <>
              <span className="text-xs text-foreground-muted">{basket ? t("onRequest") : t("from")}</span>
              <span className="text-xl font-semibold tabular-nums">
                {money(carrier.from.perKg, carrier.from.currency)} <span className="text-sm font-normal text-foreground-muted">{t("perKg")}</span>
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 sm:flex-col sm:items-stretch sm:gap-1">
          <Button asChild size="sm" variant="outline">
            <Link href={`/annonce/${card.slugId}`}>{t("view")}</Link>
          </Button>
          <label className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm sm:justify-end", !compared && !canCompare && "cursor-not-allowed opacity-50")}>
            <input type="checkbox" checked={compared} disabled={!compared && !canCompare} onChange={onCompare} className="size-4 accent-structure" data-testid="carrier-result-compare" />
            {t("compareOne")}
          </label>
        </div>
      </div>
    </article>
  );
}

function CompareDialog({ open, onOpenChange, cards, basket }: { open: boolean; onOpenChange: (open: boolean) => void; cards: DepartureCard[]; basket: boolean }) {
  const t = useTranslations("CarrierSearch.compare");
  const labels = useTranslations("Carriers");
  const format = useFormatter();
  const money = useMoney();
  const returnFocus = useReturnFocus(open);
  const descriptionId = useId();
  const short = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const modes = (value: { depot: boolean; home: boolean }, kind: "pickup" | "delivery") => [value.depot ? t(`${kind}Depot`) : null, value.home ? t(`${kind}Home`) : null].filter(Boolean).join(", ");
  const surcharge = (card: DepartureCard, kind: CarrierSurcharge) => {
    const entry = card.carrier.settings.tariff.surcharges.find((item) => item.kind === kind);
    if (!entry) return "—";
    return kind === "peak" || kind === "insurance" ? t("percent", { value: entry.value }) : money(entry.value, card.carrier.settings.tariff.currency);
  };
  const rows: { label: string; cell: (card: DepartureCard) => ReactNode; strong?: boolean }[] = [
    { label: t("departure"), cell: (card) => <span className="first-letter:uppercase">{short(card.departure.departOn)}</span> },
    { label: t("space"), cell: (card) => labels(`spaces.${card.departure.space}`) },
    ...(basket
      ? [
          {
            label: t("estimate"),
            strong: true,
            cell: (card: DepartureCard) => (card.estimate && card.estimate.total > 0 ? money(card.estimate.total, card.estimate.currency) : t("onRequest")),
          },
          {
            label: t("detail"),
            cell: (card: DepartureCard) =>
              card.estimate ? (
                <ul className="flex flex-col gap-0.5">
                  {card.estimate.lines.map((line, index) => (
                    <li key={index} className="flex justify-between gap-3">
                      <span className="text-foreground-muted">
                        {line.kind === "weight"
                          ? t("lineWeight", { kg: format.number(line.quantity, { maximumFractionDigits: 1 }) })
                          : line.kind === "item"
                            ? t("lineItem", { count: line.quantity, item: labels(`items.${line.key as CarrierItem}`) })
                            : line.kind === "minimum"
                              ? t("lineMinimum")
                              : labels(`surcharges.${line.key as CarrierSurcharge}`)}
                      </span>
                      <span className="tabular-nums">{money(line.amount, card.estimate!.currency)}</span>
                    </li>
                  ))}
                  {card.estimate.onRequest.length > 0 ? <li className="text-foreground-muted">{t("itemsOnRequest", { items: card.estimate.onRequest.map((item) => labels(`items.${item}`)).join(", ") })}</li> : null}
                </ul>
              ) : (
                "—"
              ),
          },
        ]
      : []),
    { label: t("perKg"), cell: (card) => money(card.carrier.settings.tariff.perKg, card.carrier.settings.tariff.currency) },
    { label: t("minimum"), cell: (card) => (card.carrier.settings.tariff.minimum > 0 ? money(card.carrier.settings.tariff.minimum, card.carrier.settings.tariff.currency) : "—") },
    { label: t("pickup"), cell: (card) => modes(card.carrier.settings.pickup, "pickup") },
    { label: t("delivery"), cell: (card) => modes(card.carrier.settings.delivery, "delivery") },
    { label: labels("surcharges.pickup"), cell: (card) => surcharge(card, "pickup") },
    { label: labels("surcharges.delivery"), cell: (card) => surcharge(card, "delivery") },
    { label: labels("surcharges.peak"), cell: (card) => surcharge(card, "peak") },
    { label: t("transit"), cell: (card) => t("days", { min: card.carrier.settings.transitDays.min, max: card.carrier.settings.transitDays.max }) },
    { label: t("refused"), cell: (card) => (card.carrier.settings.refused.length > 0 ? card.carrier.settings.refused.map((good) => ((CARRIER_ITEM_IDS as readonly string[]).includes(good) ? labels(`items.${good as CarrierItem}`) : labels(`restricted.${good as CarrierRestricted}`))).join(", ") : t("none")) },
    { label: t("reviews"), cell: (card) => <Stars rating={card.carrier.rating} /> },
  ];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bab-950/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          aria-describedby={descriptionId}
          data-testid="carrier-compare"
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-lg border border-border bg-surface shadow-xl shadow-bab-950/20 outline-none",
            "sm:inset-x-auto sm:start-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[88dvh] sm:w-full sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg rtl:sm:translate-x-1/2",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-start gap-3 border-b border-border px-5 pt-5 pb-4 sm:px-6">
            <div className="flex flex-1 flex-col gap-1">
              <Dialog.Title className="text-lg font-semibold">{t("title")}</Dialog.Title>
              <Dialog.Description id={descriptionId} className="text-sm text-foreground-muted text-pretty">
                {t("notice")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("close")}>
                <X aria-hidden="true" className="size-5" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky start-0 z-10 w-40 bg-surface px-4 py-3 text-start">
                    <span className="sr-only">{t("criterion")}</span>
                  </th>
                  {cards.map((card) => (
                    <th key={card.id} scope="col" className="px-4 py-3 text-start align-bottom font-semibold">
                      <Link href={`/boutique/${card.carrier.segment}`} className={cn("text-link", textLinkClassName)}>
                        {card.carrier.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-border">
                    <th scope="row" className="sticky start-0 z-10 bg-surface px-4 py-2.5 text-start align-top font-normal text-foreground-muted">
                      {row.label}
                    </th>
                    {cards.map((card) => (
                      <td key={card.id} className={cn("px-4 py-2.5 align-top", row.strong && "text-base font-semibold tabular-nums")}>
                        {row.cell(card)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <th scope="row" className="sticky start-0 z-10 bg-surface px-4 py-3" />
                  {cards.map((card) => (
                    <td key={card.id} className="px-4 py-3">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/annonce/${card.slugId}`}>{t("view")}</Link>
                      </Button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
