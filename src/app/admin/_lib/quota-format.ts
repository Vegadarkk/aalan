import type { QuotaDefinition } from "@/config/quotas";

// Wording of the free-quota board (zone 7 audit P2-6, P4): rounded amounts in French ("0,2 Go
// sur 10 Go", never "0.201326592 Go"), the share of the allowance, and a state in words ("Pas
// encore mesuré" rather than "Inconnu"). Client-safe and pure.

const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

/** Bytes in the largest unit that keeps the value readable (decimal units, as the providers bill). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${decimal.format(Math.round(bytes / 1e7) / 100)} Go`;
  if (bytes >= 1e6) return `${decimal.format(Math.round(bytes / 1e4) / 100)} Mo`;
  if (bytes >= 1e3) return `${integer.format(bytes / 1e3)} Ko`;
  return `${integer.format(bytes)} o`;
}

/** One amount in its unit: "1 234", "0,2 Go", "0,12 USD". */
export function formatQuotaValue(unit: QuotaDefinition["unit"], value: number): string {
  if (unit === "bytes") return formatBytes(value);
  if (unit === "usd_micros") return `${decimal.format(value / 1e6)} USD`;
  return integer.format(value);
}

/** "1 234 sur 50 000", "0,2 Go sur 10 Go", "0,12 USD sur 5 USD". */
export function formatQuotaAmount(unit: QuotaDefinition["unit"], used: number, limit: number): string {
  return `${formatQuotaValue(unit, used)} sur ${formatQuotaValue(unit, limit)}`;
}

/** Share of the allowance used, "moins de 1 %" below 1 %, "" when nothing is used. */
export function formatQuotaShare(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "";
  if (ratio < 0.01) return "moins de 1 %";
  return percent.format(ratio);
}

export const QUOTA_LEVEL = {
  ok: { label: "Normal", variant: "success" },
  warning: { label: "Alerte", variant: "warning" },
  degraded: { label: "Mode dégradé", variant: "danger" },
  unknown: { label: "Pas encore mesuré", variant: "neutral" },
} as const;

/** "Jour en cours" for a daily counter, the month in words for a monthly one. */
export function formatQuotaPeriod(period: string, kind: QuotaDefinition["period"]): string {
  if (kind === "day") return "Jour en cours";
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15));
  const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
