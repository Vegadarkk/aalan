// Amounts of a carrier's price list as typed in its settings (« 2,50 », « 2.5 », « 60 »): minor
// units (cents, centimes) both ways. Pure, client and server.

/** Minor units of a typed amount; null when empty, NaN when it is not an amount with 2 decimals at most. */
export function parseAmount(text: string): number | null {
  const value = text.replace(/[\s  ]/g, "").replace(",", ".");
  if (value === "") return null;
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return Number.NaN;
  const [whole = "0", decimals = ""] = value.split(".");
  return Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
}

/** A stored amount as the settings show it again: « 2,5 » → « 2,50 », « 60 » stays « 60 ». */
export function amountText(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const whole = Math.trunc(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(whole) : `${whole},${String(cents).padStart(2, "0")}`;
}
