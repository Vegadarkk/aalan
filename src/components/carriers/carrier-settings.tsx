"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { InlineError } from "@/components/feedback/inline-error";
import { CityCombobox } from "@/components/post/city-combobox";
import { ChipCheckboxGroup, ChipRadioGroup } from "@/components/post/controls/chips";
import { IntegerBox } from "@/components/post/controls/integer-box";
import { Select } from "@/components/post/controls/select";
import { SwitchField } from "@/components/post/controls/switch";
import { Textarea } from "@/components/post/controls/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import {
  CARRIER_CURRENCIES,
  CARRIER_DIRECTIONS,
  CARRIER_ITEM_IDS,
  CARRIER_ITEMS,
  CARRIER_LICENCE_PATTERN,
  CARRIER_LIMITS,
  CARRIER_RESTRICTED,
  CARRIER_SURCHARGE_IDS,
  CARRIER_SURCHARGES,
  CARRIER_VEHICLES,
  EU_ZONE_COUNTRIES,
  EU_ZONE_LIST,
  type CarrierCurrency,
  type CarrierDirection,
  type CarrierItem,
  type CarrierSurcharge,
  type CarrierVehicle,
  type EuZoneCountry,
} from "@/config/carriers";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { estimate, type Basket } from "@/lib/carriers/estimate";
import { amountText, parseAmount } from "@/lib/carriers/money";
import type { ProMeResponse, ProSelfView } from "@/lib/contracts/pro";
import { loadProMe, saveCarrier } from "@/lib/pro/client";
import { publishesAsPro, type ProState } from "@/lib/pro/lifecycle";
import { carrierSchema, type CarrierSettings, type CarrierTariff } from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";

// /pro/transport: a Europe–Morocco carrier's settings (transporteurs/spec.md §3-4): the declared
// licence, the routes (directions, EU collection zones, Moroccan cities), collection and delivery,
// the vehicle, the price list every departure uses (per kg with weight bands, minimum, volumetric
// weight, flat prices of catalogue items, surcharges), the goods refused, and a quote simulator
// showing what a client's basket is estimated at. Shown on the storefront.

type View = { kind: "loading" } | { kind: "failed"; error: unknown } | { kind: "ready"; me: ProMeResponse };

interface Draft {
  licenceRef: string;
  directions: CarrierDirection[];
  euZones: string[];
  maCities: string[];
  pickup: { depot: boolean; home: boolean };
  delivery: { depot: boolean; home: boolean };
  vehicle: { kind: CarrierVehicle; volumeM3: number | null; payloadKg: number | null };
  transitMin: number;
  transitMax: number;
  currency: CarrierCurrency;
  perKg: string;
  bands: { fromKg: number | null; perKg: string }[];
  minimum: string;
  volumetric: boolean;
  volumetricKgPerM3: number | null;
  items: Record<CarrierItem, string>;
  surcharges: Record<CarrierSurcharge, string>;
  refused: string[];
  note: string;
}

type Problem = "required" | "licence" | "amount" | "bands" | "volumetric" | "percent" | "refusedPriced";
type Problems = Partial<Record<"licenceRef" | "directions" | "euZones" | "maCities" | "perKg" | "bands" | "minimum" | "volumetric" | "items" | "surcharges", Problem>>;

const emptyRecord = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, ""])) as Record<K, string>;

function draftOf(carrier: CarrierSettings | null): Draft {
  const items = emptyRecord(CARRIER_ITEM_IDS);
  const surcharges = emptyRecord(CARRIER_SURCHARGE_IDS);
  for (const entry of carrier?.tariff.items ?? []) items[entry.item] = amountText(entry.price);
  for (const entry of carrier?.tariff.surcharges ?? []) surcharges[entry.kind] = CARRIER_SURCHARGES[entry.kind] === "percent" ? String(entry.value) : amountText(entry.value);
  return {
    licenceRef: carrier?.licenceRef ?? "",
    directions: carrier?.directions ?? ["eu_ma"],
    euZones: carrier?.euZones ?? [],
    maCities: carrier?.maCities ?? [],
    pickup: carrier?.pickup ?? { depot: true, home: false },
    delivery: carrier?.delivery ?? { depot: false, home: true },
    vehicle: carrier?.vehicle ?? { kind: "van", volumeM3: null, payloadKg: null },
    transitMin: carrier?.transitDays.min ?? 3,
    transitMax: carrier?.transitDays.max ?? 5,
    currency: carrier?.tariff.currency ?? "EUR",
    perKg: amountText(carrier?.tariff.perKg),
    bands: (carrier?.tariff.bands ?? []).map((band) => ({ fromKg: band.fromKg, perKg: amountText(band.perKg) })),
    minimum: amountText(carrier?.tariff.minimum ?? 0),
    volumetric: carrier ? carrier.tariff.volumetricKgPerM3 !== null : true,
    volumetricKgPerM3: carrier?.tariff.volumetricKgPerM3 ?? 250,
    items,
    surcharges,
    refused: carrier?.refused ?? [],
    note: carrier?.note ?? "",
  };
}

/** The draft as the API takes it, or the problems to fix first (checked as the server checks it). */
export function carrierInput(draft: Draft): { input: CarrierSettings | null; problems: Problems } {
  const problems: Problems = {};
  const licenceRef = draft.licenceRef.trim();
  if (!licenceRef) problems.licenceRef = "required";
  else if (!CARRIER_LICENCE_PATTERN.test(licenceRef)) problems.licenceRef = "licence";
  if (draft.directions.length === 0) problems.directions = "required";
  if (draft.euZones.length === 0) problems.euZones = "required";
  if (draft.maCities.length === 0) problems.maCities = "required";
  const perKg = parseAmount(draft.perKg);
  const perKgMax = CARRIER_LIMITS.perKgMax[draft.currency];
  const amountMax = CARRIER_LIMITS.amountMax[draft.currency];
  if (perKg === null) problems.perKg = "required";
  else if (!Number.isFinite(perKg) || perKg < 1 || perKg > perKgMax) problems.perKg = "amount";
  const bands = draft.bands.map((band) => ({ fromKg: band.fromKg ?? 0, perKg: parseAmount(band.perKg) ?? Number.NaN }));
  if (bands.some((band, index) => band.fromKg < 2 || band.fromKg > CARRIER_LIMITS.bandFromKgMax || !Number.isFinite(band.perKg) || band.perKg < 1 || band.perKg > perKgMax || (index > 0 && band.fromKg <= (bands[index - 1]?.fromKg ?? 0)))) problems.bands = "bands";
  const minimum = parseAmount(draft.minimum) ?? 0;
  if (!Number.isFinite(minimum) || minimum > amountMax) problems.minimum = "amount";
  if (draft.volumetric && (draft.volumetricKgPerM3 === null || draft.volumetricKgPerM3 < CARRIER_LIMITS.volumetricMin || draft.volumetricKgPerM3 > CARRIER_LIMITS.volumetricMax)) problems.volumetric = "volumetric";
  const items: CarrierTariff["items"] = [];
  for (const item of CARRIER_ITEM_IDS) {
    const price = parseAmount(draft.items[item]);
    if (price === null) continue;
    if (!Number.isFinite(price) || price < 1 || price > amountMax) problems.items = "amount";
    else if (draft.refused.includes(item)) problems.items = "refusedPriced";
    else items.push({ item, price });
  }
  const surcharges: CarrierTariff["surcharges"] = [];
  for (const kind of CARRIER_SURCHARGE_IDS) {
    const text = draft.surcharges[kind].trim();
    if (!text) continue;
    if (CARRIER_SURCHARGES[kind] === "percent") {
      const value = /^\d{1,3}$/.test(text) ? Number(text) : Number.NaN;
      if (!(value >= 1 && value <= CARRIER_LIMITS.percentMax)) problems.surcharges = "percent";
      else surcharges.push({ kind, value });
    } else {
      const value = parseAmount(text);
      if (value === null || !Number.isFinite(value) || value < 1 || value > amountMax) problems.surcharges = "amount";
      else surcharges.push({ kind, value });
    }
  }
  if (Object.keys(problems).length > 0) return { input: null, problems };
  const candidate = {
    licenceRef,
    directions: draft.directions,
    euZones: draft.euZones,
    maCities: draft.maCities,
    pickup: draft.pickup,
    delivery: draft.delivery,
    vehicle: draft.vehicle,
    transitDays: { min: Math.min(draft.transitMin, draft.transitMax), max: Math.max(draft.transitMin, draft.transitMax) },
    tariff: { currency: draft.currency, perKg: perKg ?? 0, bands, minimum, volumetricKgPerM3: draft.volumetric ? draft.volumetricKgPerM3 : null, items, surcharges },
    refused: draft.refused,
    note: draft.note.trim(),
  };
  const parsed = carrierSchema.safeParse(candidate);
  return parsed.success ? { input: parsed.data as CarrierSettings, problems } : { input: null, problems: { perKg: "amount" } };
}

export function CarrierSettingsPage() {
  const t = useTranslations("CarrierSettings");
  const apiMessage = useApiErrorMessage();
  const [view, setView] = useState<View>({ kind: "loading" });
  const started = useRef(false);

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      setView({ kind: "ready", me: await loadProMe() });
    } catch (error) {
      setView({ kind: "failed", error });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  if (view.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }
  if (view.kind === "failed") {
    return (
      <FormMessage
        error={view.error}
        title={t("loadFailed")}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {t("retry")}
          </Button>
        }
      >
        {apiMessage(view.error)}
      </FormMessage>
    );
  }
  const shop = view.me.shop;
  if (!shop || !publishesAsPro(shop.lifecycle as ProState) || shop.sector !== "carrier") {
    return (
      <ErrorBanner tone="info" title={shop && publishesAsPro(shop.lifecycle as ProState) ? t("notCarrier") : t("notVerified")}>
        <Link href="/pro" className={cn("font-medium text-link", textLinkClassName)}>
          {t("back")}
        </Link>
      </ErrorBanner>
    );
  }
  return <CarrierForm shop={shop} />;
}

function CarrierForm({ shop }: { shop: ProSelfView }) {
  const t = useTranslations("CarrierSettings");
  const labels = useTranslations("Carriers");
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const [draft, setDraft] = useState<Draft>(() => draftOf(shop.carrier));
  const [saved, setSaved] = useState(() => (shop.carrier ? JSON.stringify(shop.carrier) : null));
  const [updatedAt, setUpdatedAt] = useState(shop.carrierUpdatedAt);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [zoneCountry, setZoneCountry] = useState<EuZoneCountry>(() => (EU_ZONE_COUNTRIES as readonly string[]).includes(shop.legalCountry) ? (shop.legalCountry as EuZoneCountry) : "FR");

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const { input, problems } = useMemo(() => carrierInput(draft), [draft]);
  const dirty = input ? JSON.stringify(input) !== saved : true;
  // A missing value shows once the save was tried; a wrong one as it is typed.
  const message = (key: keyof Problems): string | undefined => {
    const problem = problems[key];
    if (!problem || (problem === "required" && !attempted)) return undefined;
    return t(`problems.${problem}`, { currency: draft.currency });
  };
  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const money = (minor: number) => format.number(minor / 100, { style: "currency", currency: draft.currency });
  const unit = draft.currency === "EUR" ? "€" : "DH";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (pending || !input || !dirty) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await saveCarrier(input);
      setDraft(draftOf(result.carrier));
      setSaved(JSON.stringify(result.carrier));
      setUpdatedAt(result.carrierUpdatedAt);
      toast.success(t("saved"));
    } catch (caught) {
      setFailure(caught);
    } finally {
      setPending(false);
    }
  }

  const zonesOf = EU_ZONE_LIST.filter((zone) => zone.country === zoneCountry);
  const allOfCountry = zonesOf.every((zone) => draft.euZones.includes(zone.id));
  const toggleZone = (id: string, on: boolean) => set({ euZones: on ? [...draft.euZones, id] : draft.euZones.filter((zone) => zone !== id) });
  const zoneCount = (country: EuZoneCountry) => draft.euZones.filter((id) => id.startsWith(`${country}-`)).length;

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate data-testid="carrier-settings" className="flex flex-col gap-8">
      <Section title={t("licenceTitle")} lead={t("licenceLead")}>
        <Field label={t("licence")} hint={t("licenceHint")} error={message("licenceRef")} required className="max-w-md">
          <Input value={draft.licenceRef} maxLength={40} autoComplete="off" spellCheck={false} dir="ltr" placeholder={t("licencePlaceholder")} onChange={(event) => set({ licenceRef: event.target.value })} />
        </Field>
      </Section>

      <Section title={t("routesTitle")} lead={t("routesLead")}>
        <Group title={t("directions")} error={message("directions")}>
          <ChipCheckboxGroup
            label={t("directions")}
            invalid={Boolean(message("directions"))}
            options={CARRIER_DIRECTIONS.map((direction) => ({ value: direction, label: labels(`directions.${direction}`) }))}
            values={draft.directions}
            onChange={(values) => set({ directions: values as CarrierDirection[] })}
          />
        </Group>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label={t("zones")} hint={t("zonesHint", { count: draft.euZones.length })} error={message("euZones")} required className="min-w-56 flex-1">
              <Select data-testid="carrier-zone-country" value={zoneCountry} onChange={(event) => setZoneCountry(event.target.value as EuZoneCountry)}>
                {EU_ZONE_COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {regionNames.of(country) ?? country}
                    {zoneCount(country) ? ` (${zoneCount(country)})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ euZones: allOfCountry ? draft.euZones.filter((id) => !id.startsWith(`${zoneCountry}-`)) : [...new Set([...draft.euZones, ...zonesOf.map((zone) => zone.id)])] })}
            >
              {allOfCountry ? t("zonesNone") : t("zonesAll")}
            </Button>
          </div>
          <fieldset className="max-h-72 overflow-y-auto rounded-md border border-border bg-surface-muted/40 p-2">
            <legend className="sr-only">{regionNames.of(zoneCountry) ?? zoneCountry}</legend>
            <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
              {zonesOf.map((zone) => (
                <label key={zone.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm hover:bg-surface">
                  <input type="checkbox" checked={draft.euZones.includes(zone.id)} onChange={(event) => toggleZone(zone.id, event.target.checked)} className="size-4 shrink-0 accent-structure" />
                  <span className="min-w-0 truncate">
                    {zone.name}
                    {zoneCountry === "FR" ? <span className="text-foreground-muted tabular-nums"> ({zone.id.slice(3)})</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <Group title={t("cities")} hint={t("citiesHint")} error={message("maCities")}>
          <div className="flex flex-col gap-3">
            {draft.maCities.length > 0 ? (
              <ul className="flex flex-wrap gap-2" data-testid="carrier-cities">
                {draft.maCities.map((slug) => {
                  const city = cityBySlug(slug);
                  return (
                    <li key={slug} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface ps-3 text-sm">
                      {city ? cityName(city, locale) : slug}
                      <button type="button" aria-label={t("cityRemove", { city: city ? cityName(city, locale) : slug })} onClick={() => set({ maCities: draft.maCities.filter((other) => other !== slug) })} className="flex size-8 items-center justify-center rounded-full text-foreground-muted hover:text-foreground">
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {draft.maCities.length < CARRIER_LIMITS.citiesMax ? <CityCombobox key={draft.maCities.length} value={null} onSelect={(city) => set({ maCities: draft.maCities.includes(city.slug) ? draft.maCities : [...draft.maCities, city.slug] })} /> : null}
          </div>
        </Group>
      </Section>

      <Section title={t("serviceTitle")} lead={t("serviceLead")}>
        <div className="grid gap-6 sm:grid-cols-2">
          <Modes title={t("pickup")} value={draft.pickup} onChange={(pickup) => set({ pickup })} labels={{ depot: t("pickupDepot"), home: t("pickupHome") }} />
          <Modes title={t("delivery")} value={draft.delivery} onChange={(delivery) => set({ delivery })} labels={{ depot: t("deliveryDepot"), home: t("deliveryHome") }} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("transitMin")}>
            <Select value={draft.transitMin} onChange={(event) => set({ transitMin: Number(event.target.value) })} className="tabular-nums">
              {Array.from({ length: CARRIER_LIMITS.transitDaysMax }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {t("days", { count })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("transitMax")}>
            <Select value={draft.transitMax} onChange={(event) => set({ transitMax: Number(event.target.value) })} className="tabular-nums">
              {Array.from({ length: CARRIER_LIMITS.transitDaysMax }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {t("days", { count })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <Section title={t("vehicleTitle")} lead={t("vehicleLead")}>
        <ChipRadioGroup label={t("vehicleTitle")} options={CARRIER_VEHICLES.map((kind) => ({ value: kind, label: labels(`vehicles.${kind}`) }))} value={draft.vehicle.kind} onChange={(kind) => set({ vehicle: { ...draft.vehicle, kind: kind as CarrierVehicle } })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("volume")} hint={t("optional")}>
            <IntegerBox value={draft.vehicle.volumeM3} onValue={(volumeM3) => set({ vehicle: { ...draft.vehicle, volumeM3 } })} max={CARRIER_LIMITS.volumeM3Max} inputMode="numeric" />
          </Field>
          <Field label={t("payload")} hint={t("optional")}>
            <IntegerBox value={draft.vehicle.payloadKg} onValue={(payloadKg) => set({ vehicle: { ...draft.vehicle, payloadKg } })} max={CARRIER_LIMITS.payloadKgMax} grouped inputMode="numeric" />
          </Field>
        </div>
      </Section>

      <Section title={t("tariffTitle")} lead={t("tariffLead")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("currency")} hint={t("currencyHint")}>
            <Select value={draft.currency} onChange={(event) => set({ currency: event.target.value as CarrierCurrency })}>
              {CARRIER_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {labels(`currencies.${currency}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("perKg", { unit })} error={message("perKg")} required>
            <Input value={draft.perKg} inputMode="decimal" dir="ltr" placeholder="2,50" className="tabular-nums" onChange={(event) => set({ perKg: event.target.value })} />
          </Field>
          <Field label={t("minimum", { unit })} hint={t("minimumHint")} error={message("minimum")}>
            <Input value={draft.minimum} inputMode="decimal" dir="ltr" placeholder="20" className="tabular-nums" onChange={(event) => set({ minimum: event.target.value })} />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t("bands")}</h3>
            <p className="text-sm text-foreground-muted text-pretty">{t("bandsHint")}</p>
          </div>
          {draft.bands.map((band, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3" data-testid="carrier-band">
              <Field label={t("bandFrom")} className="w-32">
                <IntegerBox value={band.fromKg} onValue={(fromKg) => set({ bands: draft.bands.map((other, at) => (at === index ? { ...other, fromKg } : other)) })} max={CARRIER_LIMITS.bandFromKgMax} inputMode="numeric" />
              </Field>
              <Field label={t("perKg", { unit })} className="w-32">
                <Input value={band.perKg} inputMode="decimal" dir="ltr" className="tabular-nums" onChange={(event) => set({ bands: draft.bands.map((other, at) => (at === index ? { ...other, perKg: event.target.value } : other)) })} />
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={t("bandRemove")} onClick={() => set({ bands: draft.bands.filter((_, at) => at !== index) })}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {message("bands") ? <InlineError>{message("bands")}</InlineError> : null}
          {draft.bands.length < CARRIER_LIMITS.bandsMax ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set({ bands: [...draft.bands, { fromKg: (draft.bands.at(-1)?.fromKg ?? 30) + 30, perKg: "" }] })}>
              <Plus className="size-4" aria-hidden="true" />
              {t("bandAdd")}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <SwitchField label={t("volumetric")} hint={t("volumetricHint")} checked={draft.volumetric} onCheckedChange={(volumetric) => set({ volumetric })} />
          {draft.volumetric ? (
            <Field label={t("volumetricKg")} error={message("volumetric")} className="max-w-48">
              <IntegerBox value={draft.volumetricKgPerM3} onValue={(volumetricKgPerM3) => set({ volumetricKgPerM3 })} max={CARRIER_LIMITS.volumetricMax} inputMode="numeric" />
            </Field>
          ) : null}
        </div>
      </Section>

      <Section title={t("itemsTitle")} lead={t("itemsLead")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-border text-start text-foreground-muted">
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {t("itemColumn")}
                </th>
                <th scope="col" className="w-36 py-2 pe-3 text-start font-medium">
                  {t("priceColumn", { unit })}
                </th>
                <th scope="col" className="w-24 py-2 text-start font-medium">
                  {t("refusedColumn")}
                </th>
              </tr>
            </thead>
            <tbody>
              {CARRIER_ITEM_IDS.map((item) => {
                const kg = CARRIER_ITEMS[item].kg;
                const refused = draft.refused.includes(item);
                return (
                  <tr key={item} className="border-b border-border/60 last:border-0" data-testid="carrier-item">
                    <th scope="row" className="py-2 pe-3 text-start font-normal">
                      <span className="block font-medium">{labels(`items.${item}`)}</span>
                      <span className="block text-xs text-foreground-muted">{refused ? t("itemRefused") : draft.items[item].trim() ? t("itemFlat") : kg !== null ? t("itemByWeight", { kg }) : t("itemOnRequest")}</span>
                    </th>
                    <td className="py-2 pe-3">
                      <Input
                        aria-label={t("itemPrice", { item: labels(`items.${item}`) })}
                        value={draft.items[item]}
                        disabled={refused}
                        inputMode="decimal"
                        dir="ltr"
                        className="h-9 tabular-nums"
                        onChange={(event) => set({ items: { ...draft.items, [item]: event.target.value } })}
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="checkbox"
                        aria-label={t("itemRefuse", { item: labels(`items.${item}`) })}
                        checked={refused}
                        onChange={(event) => set({ refused: event.target.checked ? [...draft.refused, item] : draft.refused.filter((other) => other !== item), items: event.target.checked ? { ...draft.items, [item]: "" } : draft.items })}
                        className="size-4 accent-structure"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {message("items") ? <InlineError>{message("items")}</InlineError> : null}
      </Section>

      <Section title={t("surchargesTitle")} lead={t("surchargesLead")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARRIER_SURCHARGE_IDS.map((kind) => (
            <Field key={kind} label={`${labels(`surcharges.${kind}`)} (${CARRIER_SURCHARGES[kind] === "percent" ? "%" : unit})`} hint={t(`surchargeHints.${kind}`)}>
              <Input value={draft.surcharges[kind]} inputMode={CARRIER_SURCHARGES[kind] === "percent" ? "numeric" : "decimal"} dir="ltr" placeholder={t("surchargeNone")} className="tabular-nums" onChange={(event) => set({ surcharges: { ...draft.surcharges, [kind]: event.target.value } })} />
            </Field>
          ))}
        </div>
        {message("surcharges") ? <InlineError>{message("surcharges")}</InlineError> : null}
      </Section>

      <Section title={t("rulesTitle")} lead={t("rulesLead")}>
        <ChipCheckboxGroup
          label={t("rulesTitle")}
          options={CARRIER_RESTRICTED.map((good) => ({ value: good, label: labels(`restricted.${good}`) }))}
          values={draft.refused.filter((good) => (CARRIER_RESTRICTED as readonly string[]).includes(good))}
          onChange={(values) => set({ refused: [...draft.refused.filter((good) => !(CARRIER_RESTRICTED as readonly string[]).includes(good)), ...values] })}
        />
        <Field label={t("note")} hint={t("noteHint", { max: CARRIER_LIMITS.noteMax })}>
          <Textarea value={draft.note} rows={3} maxLength={CARRIER_LIMITS.noteMax} dir="auto" onChange={(event) => set({ note: event.target.value })} />
        </Field>
      </Section>

      {input ? <Simulator tariff={input.tariff} money={money} /> : null}

      {failure ? <FormMessage error={failure} title={t("failed")} /> : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={pending} disabled={!dirty}>
          {t("save")}
        </Button>
        {!dirty && saved !== null ? <p className="text-sm text-foreground-muted">{updatedAt ? t("upToDateOn", { date: format.dateTime(new Date(updatedAt), { dateStyle: "long" }) }) : t("upToDate")}</p> : null}
        {attempted && !input ? <p className="text-sm text-danger">{t("fixFirst")}</p> : null}
      </div>
    </form>
  );
}

function Modes({ title, value, onChange, labels }: { title: string; value: { depot: boolean; home: boolean }; onChange: (value: { depot: boolean; home: boolean }) => void; labels: { depot: string; home: string } }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      {/* One mode at least: the last one on cannot be turned off. */}
      <SwitchField label={labels.depot} checked={value.depot} disabled={value.depot && !value.home} onCheckedChange={(depot) => onChange({ ...value, depot })} />
      <SwitchField label={labels.home} checked={value.home} disabled={value.home && !value.depot} onCheckedChange={(home) => onChange({ ...value, home })} />
    </fieldset>
  );
}

/** Items a client most often sends, offered in the simulator. */
const SIMULATOR_ITEMS = ["suitcase", "box-m", "e-scooter", "tv-large", "bicycle"] as const satisfies readonly CarrierItem[];

/** What a client's basket is estimated at with the price list as typed (spec §4: « simulateur de devis »). */
function Simulator({ tariff, money }: { tariff: CarrierTariff; money: (minor: number) => string }) {
  const t = useTranslations("CarrierSettings");
  const labels = useTranslations("Carriers");
  const [basket, setBasket] = useState<Basket>({ kg: 15, items: { suitcase: 2, "e-scooter": 1 }, options: {}, peak: false });
  const result = estimate(tariff, basket);
  const setCount = (item: CarrierItem, count: number | null) => setBasket((current) => ({ ...current, items: { ...current.items, [item]: count ?? 0 } }));
  const toggle = (option: "pickup" | "delivery") => setBasket((current) => ({ ...current, options: { ...current.options, [option]: !current.options?.[option] } }));
  return (
    <section aria-labelledby="carrier-simulator" data-testid="carrier-simulator" className="flex flex-col gap-5 rounded-lg border border-border bg-surface-brand p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        <h2 id="carrier-simulator" className="text-lg font-semibold">
          {t("simulatorTitle")}
        </h2>
        <p className="max-w-prose text-sm text-foreground-muted text-pretty">{t("simulatorLead")}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={t("simulatorKg")}>
              <IntegerBox value={basket.kg} onValue={(kg) => setBasket((current) => ({ ...current, kg: kg ?? 0 }))} max={5000} inputMode="numeric" />
            </Field>
            {SIMULATOR_ITEMS.map((item) => (
              <Field key={item} label={labels(`items.${item}`)}>
                <IntegerBox value={basket.items[item] ?? 0} onValue={(count) => setCount(item, count)} max={50} inputMode="numeric" />
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6">
            <SwitchField label={labels("surcharges.pickup")} checked={Boolean(basket.options?.pickup)} onCheckedChange={() => toggle("pickup")} />
            <SwitchField label={labels("surcharges.delivery")} checked={Boolean(basket.options?.delivery)} onCheckedChange={() => toggle("delivery")} />
            <SwitchField label={labels("surcharges.peak")} checked={Boolean(basket.peak)} onCheckedChange={(peak) => setBasket((current) => ({ ...current, peak }))} />
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
          <dl className="flex flex-col gap-2 text-sm">
            {result.lines.map((line, index) => (
              <div key={index} className="flex items-baseline justify-between gap-4">
                <dt className="text-foreground-muted">
                  {line.kind === "weight"
                    ? t("lineWeight", { kg: format1(line.quantity), rate: money(result.perKg) })
                    : line.kind === "item"
                      ? t("lineItem", { count: line.quantity, item: labels(`items.${line.key as CarrierItem}`) })
                      : line.kind === "minimum"
                        ? t("lineMinimum")
                        : labels(`surcharges.${line.key as CarrierSurcharge}`)}
                </dt>
                <dd className="tabular-nums">{money(line.amount)}</dd>
              </div>
            ))}
          </dl>
          <p className="flex items-baseline justify-between gap-4 border-t border-border pt-3 font-semibold" data-testid="carrier-simulator-total">
            <span>{t("total")}</span>
            <span className="text-xl tabular-nums">{money(result.total)}</span>
          </p>
          {result.onRequest.length > 0 ? <p className="text-sm text-foreground-muted">{t("onRequest", { items: result.onRequest.map((item) => labels(`items.${item}`)).join(", ") })}</p> : null}
          {result.unpricedOptions.length > 0 ? <p className="text-sm text-foreground-muted">{t("unpriced", { options: result.unpricedOptions.map((option) => labels(`surcharges.${option as CarrierSurcharge}`)).join(", ") })}</p> : null}
          <p className="text-xs text-foreground-muted text-pretty">{t("estimateNote")}</p>
        </div>
      </div>
    </section>
  );
}

/** A titled group of controls that are not one labelled input (chips, a list with its picker). */
function Group({ title, hint, error, children }: { title: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {title}
        <span className="ms-0.5 text-danger" aria-hidden="true">
          *
        </span>
      </span>
      {children}
      {error ? <InlineError>{error}</InlineError> : hint ? <p className="text-sm text-foreground-muted">{hint}</p> : null}
    </div>
  );
}

const format1 = (kg: number) => String(kg).replace(".", ",");

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {lead ? <p className="max-w-prose text-sm text-foreground-muted text-pretty">{lead}</p> : null}
      </header>
      {children}
    </section>
  );
}
