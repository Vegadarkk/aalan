"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { IntegerBox } from "@/components/post/controls/integer-box";
import { SwitchField } from "@/components/post/controls/switch";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CARRIER_SEARCH, type CarrierCurrency, type CarrierItem } from "@/config/carriers";
import { basketItems, type CarrierBasket } from "@/lib/carrier-requests/rules";
import { FIRST_ITEMS, MORE_ITEMS, Stepper } from "./basket-stepper";

// The client's shipment (transporteurs/spec.md §5): the basket editor of a place request (the
// listing page's « Demander une place ») and its one-line summary in the request card and the
// thread. The search's own basket (carrier-search-form.tsx) shares the stepper (basket-stepper.tsx).

/** An amount in minor units of a carrier's currency. */
export function useCarrierMoney(): (minor: number, currency: CarrierCurrency) => string {
  const format = useFormatter();
  return (minor, currency) => format.number(minor / 100, { style: "currency", currency });
}

/** The basket in words: « 20 kg de colis, 1 × Trottinette électrique, collecte à domicile ». */
export function useBasketParts(): (basket: CarrierBasket) => string[] {
  const t = useTranslations("CarrierRequest.basket");
  const labels = useTranslations("Carriers.items");
  return (basket) => [
    ...(basket.kg > 0 ? [t("summaryKg", { kg: basket.kg })] : []),
    ...basketItems(basket).map(([item, count]) => t("summaryItem", { count, item: labels(item) })),
    ...(basket.pickup ? [t("summaryPickup")] : []),
    ...(basket.delivery ? [t("summaryDelivery")] : []),
  ];
}

/** The basket editor of a place request: kilograms, items, home pickup and delivery. */
export function BasketFields({ value, onChange }: { value: CarrierBasket; onChange: (next: CarrierBasket) => void }) {
  const t = useTranslations("CarrierRequest.basket");
  const labels = useTranslations("Carriers.items");
  const [more, setMore] = useState(() => MORE_ITEMS.some((item) => value.items[item]));
  const setCount = (item: CarrierItem, count: number) => {
    const items = { ...value.items, [item]: Math.max(0, Math.min(CARRIER_SEARCH.itemMax, count)) };
    if (!items[item]) delete items[item];
    onChange({ ...value, items });
  };
  return (
    <fieldset className="flex flex-col gap-3" data-testid="carrier-request-basket">
      <legend className="mb-1 text-sm font-semibold">{t("title")}</legend>
      <Field label={t("kg")} hint={t("kgHint")} className="max-w-48">
        <IntegerBox data-testid="carrier-request-kg" value={value.kg || null} onValue={(kg) => onChange({ ...value, kg: kg ?? 0 })} max={CARRIER_SEARCH.kgMax} inputMode="numeric" />
      </Field>
      <ul className="flex flex-col divide-y divide-border">
        {[...FIRST_ITEMS, ...(more ? MORE_ITEMS : [])].map((item) => {
          const label = labels(item);
          return (
            <li key={item} className="flex min-h-12 items-center justify-between gap-3 py-1">
              <span className="text-sm">{label}</span>
              <Stepper item={label} value={value.items[item] ?? 0} onChange={(count) => setCount(item, count)} less={t("less", { item: label })} more={t("more", { item: label })} />
            </li>
          );
        })}
      </ul>
      {more ? null : (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setMore(true)}>
          {t("moreItems")}
        </Button>
      )}
      <div className="flex flex-col gap-1">
        <SwitchField label={t("pickup")} checked={value.pickup === true} onCheckedChange={(pickup) => onChange({ ...value, pickup })} />
        <SwitchField label={t("delivery")} checked={value.delivery === true} onCheckedChange={(delivery) => onChange({ ...value, delivery })} />
      </div>
    </fieldset>
  );
}
