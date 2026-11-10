import { z } from "@/lib/zod";
import { CARRIER_SPACES, DEPARTURE_LIMITS, type CarrierDirection, type CarrierSpace } from "@/config/carriers";
import { turnstileTokenSchema } from "@/lib/contracts/auth";
import type { ListingStatus, ModerationFlag, ModerationState } from "@/lib/contracts/listings";
import { departureInputSchema } from "@/lib/carriers/departure";

// « Mes départs » (transporteurs/spec.md §4): a carrier's departures, created one at a time or as a
// recurrence, edited, and their room left set in one tap. Client-safe contracts of /api/pro/departures.

export const DEPARTURE_API = {
  list: "/api/pro/departures",
  one: (id: string) => `/api/pro/departures/${id}`,
  space: (id: string) => `/api/pro/departures/${id}/space`,
} as const;

/** A recurrence: the same departure every week or every two weeks, 2 to 8 times in all. */
export const departureRepeatSchema = z
  .object({ everyWeeks: z.union([z.literal(1), z.literal(2)]), count: z.number().int().min(2).max(DEPARTURE_LIMITS.repeatMax) })
  .strict();
export type DepartureRepeat = z.infer<typeof departureRepeatSchema>;

/** POST /api/pro/departures: a departure (or a recurrence of it), published at once like a listing. */
export const departureCreateSchema = z
  .object({
    departure: departureInputSchema,
    repeat: departureRepeatSchema.optional(),
    /** The listing rules and the carrier's commitments, as « Déposer » asks. */
    acceptRules: z.literal(true),
    /** Required when the IP limit escalates (`listing.create.ip`), once for the whole batch. */
    turnstileToken: turnstileTokenSchema.optional(),
  })
  .strict();
export type DepartureCreateInput = z.infer<typeof departureCreateSchema>;

/** PUT /api/pro/departures/{id}: new facts of a departure (dates, places, room, note). */
export const departureEditSchema = z.object({ departure: departureInputSchema }).strict();
export type DepartureEditInput = z.infer<typeof departureEditSchema>;

/** PUT /api/pro/departures/{id}/space: the room left, one tap; `spaceKg` null clears the kilograms. */
export const departureSpaceSchema = z
  .object({ space: z.enum(CARRIER_SPACES), spaceKg: z.number().int().min(1).max(DEPARTURE_LIMITS.spaceKgMax).nullable().optional() })
  .strict();
export type DepartureSpaceInput = z.infer<typeof departureSpaceSchema>;

export interface DepartureView {
  direction: CarrierDirection;
  departOn: string;
  depositBy: string;
  arriveFrom: string;
  arriveTo: string;
  euZones: string[];
  maCities: string[];
  space: CarrierSpace;
  spaceKg: number | null;
  note: string;
  /** ISO 8601. */
  spaceUpdatedAt: string;
}

export interface OwnerDeparture {
  id: string;
  slugId: string | null;
  status: ListingStatus;
  title: string;
  departure: DepartureView;
  moderation: { state: ModerationState; flags: ModerationFlag[] };
}

/** What the departure form offers: the areas and directions of the carrier's price list. */
export interface DepartureSettings {
  directions: CarrierDirection[];
  euZones: string[];
  maCities: string[];
  transitDays: { min: number; max: number };
}

/** GET /api/pro/departures: upcoming departures by date, then the latest past ones (to copy). */
export interface DeparturesResponse {
  upcoming: OwnerDeparture[];
  past: OwnerDeparture[];
  /** null until the carrier saved its settings and price list (/pro/transport). */
  settings: DepartureSettings | null;
  /** The carriers space is open (`carriersEnabled`): departures can be published. */
  open: boolean;
}

export interface DepartureCreateResponse {
  created: { id: string; departOn: string; status: "published" | "pending_review"; slugId: string }[];
  /** The first departure that could not be published (the later ones were not tried), with the API code. */
  failed: { departOn: string; code: string } | null;
}

export interface DepartureResponse {
  departure: OwnerDeparture;
}
