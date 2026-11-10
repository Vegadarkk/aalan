import { CARRIER_DIRECTIONS, CARRIER_LIMITS, CARRIER_SPACES, DEPARTURE_LIMITS, euZoneById, isEuZone, type CarrierDirection } from "@/config/carriers";
import { cityBySlug } from "@/config/regions";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/contracts/listings";
import { DAY_PATTERN, dayNumber, dayString } from "@/lib/listings/rental-availability";
import { z } from "@/lib/zod";

// A carrier's departure (transporteurs/spec.md §3-4): one listing of the « Départs Europe–Maroc »
// subcategory, created from « Mes départs », never from the wizard. Its facts live on the listing
// (`departure`); the title, the description, the place and the direction criterion are written
// from them, in French like the rest of a listing's text. Client-safe: the form and the API share it.

const DAY_MS = 86_400_000;
const day = z.string().regex(DAY_PATTERN);

/** The facts a carrier sets on a departure; the dates are Morocco calendar days. */
export const departureFields = {
  direction: z.enum(CARRIER_DIRECTIONS),
  departOn: day,
  /** Last day to drop parcels (or to be collected), on or before the departure. */
  depositBy: day,
  /** Estimated arrival, a range of days. */
  arriveFrom: day,
  arriveTo: day,
  /** EU zones of this tour: collected from (to Morocco) or delivered to (from Morocco). */
  euZones: z.array(z.string().max(8).refine(isEuZone, "unknown zone")).min(1).max(CARRIER_LIMITS.zonesMax),
  /** Moroccan cities of this tour: delivered to (from Europe) or collected from (to Europe). */
  maCities: z.array(z.string().min(1).max(60)).min(1).max(CARRIER_LIMITS.citiesMax),
  space: z.enum(CARRIER_SPACES),
  /** Kilograms left, when the carrier says it. */
  spaceKg: z.number().int().min(1).max(DEPARTURE_LIMITS.spaceKgMax).optional(),
  note: z.string().trim().max(DEPARTURE_LIMITS.noteMax).optional(),
};

/** Date issues of a departure that do not depend on today (the service checks today's window). */
export function departureOrderIssues(value: { departOn: string; depositBy: string; arriveFrom: string; arriveTo: string }): { path: string; code: string }[] {
  const issues: { path: string; code: string }[] = [];
  const [departOn, depositBy, arriveFrom, arriveTo] = [value.departOn, value.depositBy, value.arriveFrom, value.arriveTo].map(dayNumber);
  for (const [path, at] of [["departOn", departOn], ["depositBy", depositBy], ["arriveFrom", arriveFrom], ["arriveTo", arriveTo]] as const) {
    if (Number.isNaN(at)) issues.push({ path, code: "invalid_day" });
  }
  if (issues.length > 0) return issues;
  if (depositBy! > departOn! || depositBy! < departOn! - DEPARTURE_LIMITS.depositDaysMax) issues.push({ path: "depositBy", code: "deposit_window" });
  if (arriveFrom! < departOn! || arriveFrom! > departOn! + DEPARTURE_LIMITS.arrivalDaysMax) issues.push({ path: "arriveFrom", code: "arrival_window" });
  if (arriveTo! < arriveFrom! || arriveTo! > departOn! + DEPARTURE_LIMITS.arrivalDaysMax) issues.push({ path: "arriveTo", code: "arrival_window" });
  return issues;
}

/** A departure as the form sends it: the facts, dates in order, no duplicate place. */
export const departureInputSchema = z
  .object(departureFields)
  .strict()
  .superRefine((value, context) => {
    for (const issue of departureOrderIssues(value)) context.addIssue({ code: "custom", path: [issue.path], message: issue.code });
    if (new Set(value.euZones).size !== value.euZones.length) context.addIssue({ code: "custom", path: ["euZones"], message: "duplicate" });
    if (new Set(value.maCities).size !== value.maCities.length) context.addIssue({ code: "custom", path: ["maCities"], message: "duplicate" });
  });
export type DepartureInput = z.infer<typeof departureInputSchema>;

/** Where a departure stands against today: too early (past) or too far ahead. */
export function departureWindowIssue(departOn: string, today: number): "departure_past" | "departure_too_far" | null {
  const at = dayNumber(departOn);
  if (at < today) return "departure_past";
  if (at > today + DEPARTURE_LIMITS.aheadDays) return "departure_too_far";
  return null;
}

/** The moment a departure leaves the site: the day after it (spec §3), at 00:00 UTC. */
export function departureEnd(departOn: string): Date {
  return new Date((dayNumber(departOn) + 1) * DAY_MS);
}

/** The same departure `days` later (« Dupliquer », a recurrence): every date moves together. */
export function shiftDeparture<T extends { departOn: string; depositBy: string; arriveFrom: string; arriveTo: string }>(departure: T, days: number): T {
  const move = (value: string) => dayString(dayNumber(value) + days);
  return { ...departure, departOn: move(departure.departOn), depositBy: move(departure.depositBy), arriveFrom: move(departure.arriveFrom), arriveTo: move(departure.arriveTo) };
}

/** Where the parcels are collected and where they are delivered, as place names (French). */
export function departurePlaces(departure: Pick<DepartureInput, "direction" | "euZones" | "maCities">): { from: string[]; to: string[] } {
  const zones = departure.euZones.map((id) => euZoneById(id)?.name ?? id);
  const cities = departure.maCities.map((slug) => cityBySlug(slug)?.nameFr ?? slug);
  return departure.direction === "eu_ma" ? { from: zones, to: cities } : { from: cities, to: zones };
}

const frenchDay = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const DIRECTION_TEXT: Record<CarrierDirection, string> = { eu_ma: "Europe → Maroc", ma_eu: "Maroc → Europe" };

/** « Lyon +2 → Nador · départ le 12/12/2026 »: within TITLE_MAX whatever the place names. */
export function departureTitle(departure: Pick<DepartureInput, "direction" | "euZones" | "maCities" | "departOn">): string {
  const { from, to } = departurePlaces(departure);
  const side = (names: string[]) => `${clip(names[0] ?? "", 20)}${names.length > 1 ? ` +${names.length - 1}` : ""}`;
  return clip(`${side(from)} → ${side(to)} · départ le ${frenchDay(departure.departOn)}`, TITLE_MAX);
}

/** Places named in the description before « et N autres ». */
const PLACES_LISTED = 30;

/** The facts in plain French, then the carrier's note: what search and the page's text read. */
export function departureDescription(departure: DepartureInput): string {
  const { from, to } = departurePlaces(departure);
  const list = (names: string[]) => (names.length > PLACES_LISTED ? `${names.slice(0, PLACES_LISTED).join(", ")} et ${names.length - PLACES_LISTED} autres` : names.join(", "));
  const arrival = departure.arriveFrom === departure.arriveTo ? `Arrivée estimée le ${frenchDay(departure.arriveFrom)}.` : `Arrivée estimée entre le ${frenchDay(departure.arriveFrom)} et le ${frenchDay(departure.arriveTo)}.`;
  const lines = [
    `Départ ${DIRECTION_TEXT[departure.direction]} le ${frenchDay(departure.departOn)}. Dépôt des colis jusqu'au ${frenchDay(departure.depositBy)}. ${arrival}`,
    `Collecte : ${list(from)}.`,
    `Livraison : ${list(to)}.`,
  ];
  const note = departure.note?.trim();
  return clip(note ? `${lines.join("\n")}\n\n${note}` : lines.join("\n"), DESCRIPTION_MAX);
}

/** Up to DEPARTURE_LIMITS.repeatMax departures every `everyWeeks` weeks, the first one included. */
export function repeatedDepartures<T extends { departOn: string; depositBy: string; arriveFrom: string; arriveTo: string }>(first: T, repeat: { everyWeeks: 1 | 2; count: number } | undefined): T[] {
  const count = Math.min(Math.max(1, repeat?.count ?? 1), DEPARTURE_LIMITS.repeatMax);
  return Array.from({ length: count }, (_, index) => (index === 0 ? first : shiftDeparture(first, index * 7 * (repeat?.everyWeeks ?? 1))));
}
