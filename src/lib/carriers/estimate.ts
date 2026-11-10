import { CARRIER_ITEMS, type CarrierItem } from "@/config/carriers";
import type { CarrierTariff } from "@/lib/pro/profile-schema";

// Price estimate of a client's shipment from a carrier's price list (transporteurs/spec.md §5): what
// the comparator ranks and the carrier's settings preview. Pure, client and server. An estimate,
// never a quote: the carrier weighs the parcels and stays bound by the price list it declared.

export interface Basket {
  /** Loose weight in kg (boxes, bags) on top of the items. */
  kg: number;
  /** Volume in m³ of the loose weight, when known (volumetric weight). */
  m3?: number;
  items: Partial<Record<CarrierItem, number>>;
  /** Home pickup, home delivery, fragile handling, remote area: added when the list prices them. */
  options?: { pickup?: boolean; delivery?: boolean; fragile?: boolean; remote?: boolean };
  /** High season: the list's `peak` percent on the whole price. */
  peak?: boolean;
  /** Declared value in the list's currency (minor units), for its `insurance` percent. */
  declaredValue?: number;
}

export interface EstimateLine {
  kind: "weight" | "item" | "minimum" | "surcharge";
  /** The item or the surcharge; null for the weight and the minimum. */
  key: string | null;
  quantity: number;
  amount: number;
}

export interface Estimate {
  /** Minor units of `currency`. */
  total: number;
  currency: CarrierTariff["currency"];
  /** Kilograms charged at the per-kg rate (loose weight, volumetric if higher, items counted by weight). */
  chargedKg: number;
  /** The per-kg rate applied (its weight band). */
  perKg: number;
  lines: EstimateLine[];
  /** Items the list neither prices nor weighs: « sur devis », left out of the total. */
  onRequest: CarrierItem[];
  /** An option asked that the list does not price (free, or not offered: to ask the carrier). */
  unpricedOptions: string[];
}

/** The rate of a weight: the base rate, or the band of the highest `fromKg` reached. */
export function ratePerKg(tariff: Pick<CarrierTariff, "perKg" | "bands">, kg: number): number {
  let rate = tariff.perKg;
  for (const band of tariff.bands) if (kg >= band.fromKg) rate = band.perKg;
  return rate;
}

const roundKg = (kg: number) => Math.ceil(kg * 10) / 10;

export function estimate(tariff: CarrierTariff, basket: Basket): Estimate {
  const flat = new Map(tariff.items.map((entry) => [entry.item, entry.price]));
  const surcharges = new Map(tariff.surcharges.map((entry) => [entry.kind, entry.value]));
  const lines: EstimateLine[] = [];
  const onRequest: CarrierItem[] = [];
  let itemKg = 0;
  for (const [item, count] of Object.entries(basket.items) as [CarrierItem, number][]) {
    if (!count || count <= 0) continue;
    const price = flat.get(item);
    if (price !== undefined) lines.push({ kind: "item", key: item, quantity: count, amount: price * count });
    else if (CARRIER_ITEMS[item].kg !== null) itemKg += (CARRIER_ITEMS[item].kg ?? 0) * count;
    else onRequest.push(item);
  }
  const loose = Math.max(0, basket.kg);
  const volumetric = tariff.volumetricKgPerM3 !== null && basket.m3 ? basket.m3 * tariff.volumetricKgPerM3 : 0;
  const chargedKg = roundKg(Math.max(loose, volumetric) + itemKg);
  const perKg = ratePerKg(tariff, chargedKg);
  if (chargedKg > 0) lines.unshift({ kind: "weight", key: null, quantity: chargedKg, amount: Math.round(chargedKg * perKg) });

  let subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  if (subtotal > 0 && subtotal < tariff.minimum) {
    lines.push({ kind: "minimum", key: null, quantity: 1, amount: tariff.minimum - subtotal });
    subtotal = tariff.minimum;
  }

  const unpricedOptions: string[] = [];
  for (const option of ["pickup", "delivery", "fragile", "remote"] as const) {
    if (!basket.options?.[option]) continue;
    const value = surcharges.get(option);
    if (value === undefined) unpricedOptions.push(option);
    else lines.push({ kind: "surcharge", key: option, quantity: 1, amount: value });
  }
  const insurance = surcharges.get("insurance");
  if (basket.declaredValue && insurance !== undefined) lines.push({ kind: "surcharge", key: "insurance", quantity: 1, amount: Math.round((basket.declaredValue * insurance) / 100) });
  let total = lines.reduce((sum, line) => sum + line.amount, 0);
  const peak = surcharges.get("peak");
  if (basket.peak && peak !== undefined && total > 0) {
    const amount = Math.round((total * peak) / 100);
    lines.push({ kind: "surcharge", key: "peak", quantity: 1, amount });
    total += amount;
  }
  return { total, currency: tariff.currency, chargedKg, perKg, lines, onRequest, unpricedOptions };
}
