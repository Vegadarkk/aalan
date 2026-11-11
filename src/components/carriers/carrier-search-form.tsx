"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Package, Plus, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FIRST_ITEMS, MORE_ITEMS, Stepper } from "@/components/carriers/basket-stepper";
import { CityCombobox } from "@/components/post/city-combobox";
import { ChipRadioGroup } from "@/components/post/controls/chips";
import { IntegerBox } from "@/components/post/controls/integer-box";
import { Select } from "@/components/post/controls/select";
import { SwitchField } from "@/components/post/controls/switch";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CARRIER_DIRECTIONS, CARRIER_SEARCH, EU_ZONE_COUNTRIES, EU_ZONE_LIST, type CarrierDirection, type CarrierItem, type EuZoneCountry } from "@/config/carriers";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { useRouter } from "@/i18n/navigation";
import { CARRIER_SORTS, carrierSearchPath, type CarrierSearchParams, type CarrierSort } from "@/lib/carriers/search-params";
import { cn } from "@/lib/utils";

// The search of /transporteurs (transporteurs/spec.md §5): the route (direction, EU country or
// zone, Moroccan city), the period and the client's basket. Submitting navigates: the page renders
// the results on the server from the query string.

export function CarrierSearchForm({ params, period, searched = false, className }: { params: CarrierSearchParams; period: { from: string; to: string }; searched?: boolean; className?: string }) {
  const t = useTranslations("CarrierSearch.form");
  const labels = useTranslations("Carriers");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<CarrierSearchParams>(params);
  const [more, setMore] = useState(() => MORE_ITEMS.some((item) => params.items?.[item]));
  // On a phone, a search done folds the form so the results come first (always open from lg on).
  const [unfolded, setUnfolded] = useState(!searched);
  const regionNames = new Intl.DisplayNames([locale === "rif" ? "fr" : locale], { type: "region" });
  const set = (patch: Partial<CarrierSearchParams>) => setDraft((current) => ({ ...current, ...patch }));
  const go = (next: CarrierSearchParams) => startTransition(() => router.push(carrierSearchPath(next), { scroll: false }));
  const zones = draft.country ? EU_ZONE_LIST.filter((zone) => zone.country === draft.country) : [];
  const city = draft.city ? cityBySlug(draft.city) : null;
  const count = (item: CarrierItem) => draft.items?.[item] ?? 0;
  const setCount = (item: CarrierItem, value: number) => {
    const items = {
      ...draft.items,
      [item]: Math.max(0, Math.min(CARRIER_SEARCH.itemMax, value)),
    };
    if (!items[item]) delete items[item];
    set({ items });
  };
  const basketSize = (draft.kg ? 1 : 0) + Object.values(draft.items ?? {}).filter(Boolean).length;

  function submit(event: FormEvent) {
    event.preventDefault();
    go(draft);
  }

  const europe = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <Field label={t("country")}>
        <Select
          data-testid="carrier-search-country"
          value={draft.country ?? ""}
          onChange={(event) =>
            set({
              country: (event.target.value || undefined) as EuZoneCountry | undefined,
              zone: undefined,
            })
          }
        >
          <option value="">{t("anyCountry")}</option>
          {EU_ZONE_COUNTRIES.map((country) => (
            <option key={country} value={country}>
              {regionNames.of(country) ?? country}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("zone")}>
        <Select data-testid="carrier-search-zone" value={draft.zone ?? ""} disabled={!draft.country} onChange={(event) => set({ zone: event.target.value || undefined })}>
          <option value="">{draft.country ? t("anyZone") : t("zoneFirst")}</option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
              {zone.country === "FR" ? ` (${zone.id.slice(3)})` : ""}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
  const morocco = (
    <Field label={t("city")}>
      {city ? (
        <span className="inline-flex min-h-11 items-center gap-1 self-start rounded-md border border-border-control bg-surface ps-3.5 text-base">
          {cityName(city, locale)}
          <button type="button" aria-label={t("cityClear", { city: cityName(city, locale) })} onClick={() => set({ city: undefined })} className="flex size-10 items-center justify-center rounded-md text-foreground-muted hover:text-foreground">
            <X aria-hidden="true" className="size-4" />
          </button>
        </span>
      ) : (
        <CityCombobox value={null} onSelect={(picked) => set({ city: picked.slug })} />
      )}
    </Field>
  );
  const toMorocco = draft.direction === "eu_ma";

  return (
    <>
      <Button type="button" variant="outline" className={cn("w-full lg:hidden", unfolded && "hidden")} aria-expanded={unfolded} onClick={() => setUnfolded(true)} data-testid="carrier-search-unfold">
        <Search aria-hidden="true" className="size-4" />
        {t("edit")}
      </Button>
      <form onSubmit={submit} data-testid="carrier-search" aria-label={t("label")} className={cn("flex-col gap-5 lg:flex", unfolded ? "flex" : "hidden", className)}>
        <ChipRadioGroup
          label={t("direction")}
          options={CARRIER_DIRECTIONS.map((value) => ({
            value,
            label: labels(`directions.${value}`),
          }))}
          value={draft.direction}
          onChange={(value) => set({ direction: value as CarrierDirection })}
        />

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">{toMorocco ? t("fromEurope") : t("fromMorocco")}</legend>
          {toMorocco ? europe : morocco}
        </fieldset>
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">{toMorocco ? t("toMorocco") : t("toEurope")}</legend>
          {toMorocco ? morocco : europe}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("from")}>
            <Input type="date" data-testid="carrier-search-from" value={draft.from ?? period.from} min={period.from} onChange={(event) => set({ from: event.target.value || undefined })} />
          </Field>
          <Field label={t("to")}>
            <Input type="date" data-testid="carrier-search-to" value={draft.to ?? period.to} min={draft.from ?? period.from} onChange={(event) => set({ to: event.target.value || undefined })} />
          </Field>
        </div>
        <SwitchField label={t("full")} checked={Boolean(draft.full)} onCheckedChange={(full) => set({ full: full || undefined })} />

        <details open={basketSize > 0} className="group rounded-lg border border-border bg-surface" data-testid="carrier-basket">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <Package aria-hidden="true" className="size-5 shrink-0 text-structure dark:text-gold-300" />
            <span className="flex flex-col">
              <span className="font-semibold">{t("basket")}</span>
              <span className="text-sm text-foreground-muted">{basketSize > 0 ? t("basketCount", { count: basketSize }) : t("basketHint")}</span>
            </span>
            <Plus aria-hidden="true" className="ms-auto size-4 text-foreground-muted transition-transform duration-150 group-open:rotate-45" />
          </summary>
          <div className="flex flex-col gap-4 border-t border-border px-4 pt-4 pb-5">
            <Field label={t("kg")} hint={t("kgHint")} className="max-w-48">
              <IntegerBox data-testid="carrier-basket-kg" value={draft.kg ?? null} onValue={(kg) => set({ kg: kg || undefined })} max={CARRIER_SEARCH.kgMax} inputMode="numeric" />
            </Field>
            <ul className="flex flex-col divide-y divide-border">
              {[...FIRST_ITEMS, ...(more ? MORE_ITEMS : [])].map((item) => (
                <li key={item} className="flex min-h-12 items-center justify-between gap-3 py-1.5">
                  <span className="text-sm">{labels(`items.${item}`)}</span>
                  <Stepper item={labels(`items.${item}`)} value={count(item)} onChange={(value) => setCount(item, value)} less={t("less", { item: labels(`items.${item}`) })} more={t("more", { item: labels(`items.${item}`) })} />
                </li>
              ))}
            </ul>
            {more ? null : (
              <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setMore(true)}>
                {t("moreItems")}
              </Button>
            )}
            <div className="flex flex-col gap-1">
              <SwitchField label={t("pickup")} checked={Boolean(draft.pickup)} onCheckedChange={(pickup) => set({ pickup: pickup || undefined })} />
              <SwitchField label={t("delivery")} checked={Boolean(draft.delivery)} onCheckedChange={(delivery) => set({ delivery: delivery || undefined })} />
            </div>
          </div>
        </details>

        <Button type="submit" size="lg" loading={pending} data-testid="carrier-search-submit">
          <Search aria-hidden="true" className="size-4" />
          {t("submit")}
        </Button>
      </form>
    </>
  );
}

/** The order of the results: navigates at once (the rest of the search unchanged). */
export function CarrierSortSelect({ params, basket }: { params: CarrierSearchParams; basket: boolean }) {
  const t = useTranslations("CarrierSearch.sort");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-foreground-muted">{t("label")}</span>
      <Select
        data-testid="carrier-search-sort"
        value={params.sort}
        disabled={pending}
        className="w-auto"
        onChange={(event) =>
          startTransition(() =>
            router.push(
              carrierSearchPath({
                ...params,
                sort: event.target.value as CarrierSort,
              }),
              { scroll: false },
            ),
          )
        }
      >
        {CARRIER_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {sort === "price" && !basket ? t("priceFrom") : t(sort)}
          </option>
        ))}
      </Select>
    </label>
  );
}
