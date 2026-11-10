import "server-only";
import { DEPARTURE_SUBCATEGORY } from "@/config/categories";
import { DEPARTURE_LIMITS } from "@/config/carriers";
import { cityBySlug } from "@/config/regions";
import type { AuthContext } from "@/lib/auth/guards";
import { requireOwner } from "@/lib/auth/guards";
import type { Device } from "@/lib/auth/respond";
import { getFlags } from "@/lib/config/runtime";
import type { DepartureCreateInput, DepartureCreateResponse, DepartureEditInput, DeparturesResponse, DepartureSettings, DepartureSpaceInput, OwnerDeparture } from "@/lib/contracts/departures";
import type { ListingPatch, ListingStatus } from "@/lib/contracts/listings";
import { getListing, listOwnerListingsOf, type ListingRecord } from "@/lib/db/repositories/listings";
import type { DepartureDoc } from "@/lib/db/schemas";
import { HttpError, notFound } from "@/lib/http/errors";
import { escalateOnIp } from "@/lib/listings/escalation";
import { dayNumber, moroccoToday } from "@/lib/listings/rental-availability";
import { changeStatus, createDraft, patchListing, publish, sellerOf, setDepartureSpace, type Actor } from "@/lib/listings/service";
import { logger } from "@/lib/logging/logger";
import { ownedPublishingShop } from "@/lib/pro/service";
import type { CarrierSettings } from "@/lib/pro/profile-schema";
import { departureDescription, departureTitle, departureWindowIssue, repeatedDepartures, type DepartureInput } from "./departure";

// « Mes départs » (transporteurs/spec.md §4): a carrier's departures are listings of the
// « Départs Europe–Maroc » subcategory, published through the listing service like any other
// (readiness, screening, quotas, daily limit, moderation hold), their text written from the facts.
// A recurrence publishes its departures one after the other and stops at the first refusal.

/** Departures « Mes départs » reads: what is online or may come back, and the past ones to copy. */
const LISTED_STATUSES: readonly ListingStatus[] = ["published", "paused", "pending_review", "expired"];
/** Past departures shown, newest first (« Dupliquer » starts from them). */
const PAST_SHOWN = 10;
/** Statuses whose facts the carrier may still change (an expired departure is copied instead). */
const EDITABLE: readonly ListingStatus[] = ["published", "paused", "pending_review"];

const invalid = (path: string, code: string) => new HttpError(400, "invalid_body", undefined, { details: [{ path, code }] });

function viewOf(listing: ListingRecord): OwnerDeparture | null {
  const departure = listing.departure;
  if (!departure) return null;
  return {
    id: listing.id,
    slugId: listing.slugId ?? null,
    status: listing.status,
    title: listing.title,
    departure: {
      direction: departure.direction,
      departOn: departure.departOn,
      depositBy: departure.depositBy,
      arriveFrom: departure.arriveFrom,
      arriveTo: departure.arriveTo,
      euZones: departure.euZones,
      maCities: departure.maCities,
      space: departure.space,
      spaceKg: departure.spaceKg ?? null,
      note: departure.note ?? "",
      spaceUpdatedAt: departure.spaceUpdatedAt.toISOString(),
    },
    moderation: { state: listing.moderation.state, flags: listing.moderation.flags },
  };
}

function settingsOf(carrier: CarrierSettings | undefined): DepartureSettings | null {
  if (!carrier) return null;
  return { directions: [...carrier.directions], euZones: [...carrier.euZones], maCities: [...carrier.maCities], transitDays: { ...carrier.transitDays } };
}

/** The carrier shop of the signed-in owner (409 when the shop is not a carrier). */
async function carrierShop(auth: AuthContext) {
  if (auth.user.claims.role !== "pro") throw new HttpError(403, "forbidden", "departures are for carrier shops");
  const profile = await ownedPublishingShop(auth);
  if (profile.sector !== "carrier") throw new HttpError(409, "conflict", "the shop is not a carrier");
  return profile;
}

/** GET /api/pro/departures. */
export async function listDepartures(auth: AuthContext, now = new Date()): Promise<DeparturesResponse> {
  const profile = await carrierShop(auth);
  const [listings, flags] = await Promise.all([listOwnerListingsOf(auth.user.uid, DEPARTURE_SUBCATEGORY, LISTED_STATUSES, DEPARTURE_LIMITS.listMax), getFlags()]);
  const today = moroccoToday(now);
  const views = listings.map(viewOf).filter((view): view is OwnerDeparture => view !== null);
  const upcoming = views.filter((view) => view.status !== "expired" && dayNumber(view.departure.departOn) >= today).sort((a, b) => a.departure.departOn.localeCompare(b.departure.departOn));
  const shown = new Set(upcoming.map((view) => view.id));
  const past = views
    .filter((view) => !shown.has(view.id))
    .sort((a, b) => b.departure.departOn.localeCompare(a.departure.departOn))
    .slice(0, PAST_SHOWN);
  return { upcoming, past, settings: settingsOf(profile.carrier), open: flags.carriersEnabled };
}

/** A departure must stay within the carrier's own price list: its directions and its areas. */
function checkDeparture(departure: DepartureInput, carrier: CarrierSettings, today: number): void {
  if (!carrier.directions.includes(departure.direction)) throw invalid("departure.direction", "direction_not_served");
  const zones = new Set(carrier.euZones);
  const zone = departure.euZones.findIndex((id) => !zones.has(id));
  if (zone >= 0) throw invalid(`departure.euZones.${zone}`, "zone_not_served");
  const cities = new Set(carrier.maCities);
  const city = departure.maCities.findIndex((slug) => !cities.has(slug) || !cityBySlug(slug));
  if (city >= 0) throw invalid(`departure.maCities.${city}`, "city_not_served");
  const window = departureWindowIssue(departure.departOn, today);
  if (window) throw invalid("departure.departOn", window);
}

/** The listing fields written from a departure: title, text, direction, place (its first Moroccan city), contact. */
function listingFields(departure: DepartureInput, phoneVerified: boolean): ListingPatch {
  const city = cityBySlug(departure.maCities[0]!)!;
  return {
    title: departureTitle(departure),
    description: departureDescription(departure),
    attributes: { "departure-direction": departure.direction === "eu_ma" ? "europe-maroc" : "maroc-europe" },
    location: { regionCode: city.regionCode, citySlug: city.slug },
    // Call and WhatsApp next to the messaging when the shop's number is verified (spec §5).
    contact: { showPhone: phoneVerified, whatsapp: phoneVerified },
  };
}

function docOf(departure: DepartureInput, spaceUpdatedAt: Date): DepartureDoc {
  const { note, spaceKg, ...facts } = departure;
  const trimmed = note?.trim();
  return { ...facts, ...(spaceKg !== undefined && departure.space !== "full" ? { spaceKg } : {}), ...(trimmed ? { note: trimmed } : {}), spaceUpdatedAt };
}

export interface CreateOutcome {
  body: DepartureCreateResponse;
  turnstilePassed: boolean;
}

/** POST /api/pro/departures: one departure, or every departure of a recurrence, published in date order. */
export async function createDepartures(actor: Actor, request: Request, input: DepartureCreateInput, device: Device, now = new Date()): Promise<CreateOutcome> {
  if (!(await getFlags()).carriersEnabled) throw new HttpError(403, "carriers_closed", "the carriers space is closed");
  await carrierShop(actor.auth);
  const seller = await sellerOf(actor.auth);
  if (!seller.carrier) throw new HttpError(422, "carrier_settings_missing");
  const today = moroccoToday(now);
  const departures = repeatedDepartures(input.departure, input.repeat);
  for (const departure of departures) checkDeparture(departure, seller.carrier, today);
  // One IP check for the batch: a Turnstile token serves once.
  const turnstilePassed = await escalateOnIp(request, "listing.create.ip", device, input.turnstileToken, "listing");
  const phoneVerified = seller.user.badges.phoneVerified;
  const body: DepartureCreateResponse = { created: [], failed: null };
  for (const departure of departures) {
    let id: string | null = null;
    try {
      id = (await createDraft(actor, { subcategoryId: DEPARTURE_SUBCATEGORY }, now, { patch: listingFields(departure, phoneVerified), seller, departure: docOf(departure, now) })).id;
      const outcome = await publish(actor, request, id, { device, now, ipChecked: true, quiet: true });
      body.created.push({ id, departOn: departure.departOn, status: outcome.response.status === "pending_review" ? "pending_review" : "published", slugId: outcome.response.slugId ?? "" });
    } catch (error) {
      // The draft of a refused departure goes: « Mes annonces » never shows a departure it cannot publish.
      if (id) await discard(actor, id);
      if (body.created.length === 0) throw error;
      body.failed = { departOn: departure.departOn, code: error instanceof HttpError ? error.code : "internal" };
      if (!(error instanceof HttpError)) logger.error({ err: (error as Error).message }, "departure not published");
      break;
    }
  }
  return { body, turnstilePassed };
}

async function discard(actor: Actor, id: string): Promise<void> {
  try {
    await changeStatus(actor, id, "remove");
  } catch (error) {
    logger.warn({ listingId: id, err: (error as Error).message }, "refused departure draft not removed");
  }
}

async function ownedDeparture(actor: Actor, id: string): Promise<ListingRecord & { departure: DepartureDoc }> {
  const listing = await getListing(id);
  if (!listing || !listing.departure) throw notFound();
  requireOwner(actor.auth, listing);
  return listing as ListingRecord & { departure: DepartureDoc };
}

/** PUT /api/pro/departures/{id}: new facts, the title and text written again (screened like an edit). */
export async function editDeparture(actor: Actor, id: string, input: DepartureEditInput, now = new Date()): Promise<OwnerDeparture> {
  await carrierShop(actor.auth);
  const listing = await ownedDeparture(actor, id);
  if (!EDITABLE.includes(listing.status)) throw new HttpError(409, "conflict", "an expired departure is copied, not edited");
  const seller = await sellerOf(actor.auth);
  if (!seller.carrier) throw new HttpError(422, "carrier_settings_missing");
  checkDeparture(input.departure, seller.carrier, moroccoToday(now));
  const sameSpace = input.departure.space === listing.departure.space && (input.departure.space === "full" ? undefined : input.departure.spaceKg) === listing.departure.spaceKg;
  await patchListing(actor, id, listingFields(input.departure, seller.user.badges.phoneVerified), now, { departure: docOf(input.departure, sameSpace ? listing.departure.spaceUpdatedAt : now) });
  const updated = await getListing(id);
  const view = updated ? viewOf(updated) : null;
  if (!view) throw notFound();
  return view;
}

/** PUT /api/pro/departures/{id}/space: the room left, one tap. */
export async function updateDepartureSpace(actor: Actor, id: string, input: DepartureSpaceInput, now = new Date()): Promise<OwnerDeparture> {
  const view = viewOf(await setDepartureSpace(actor, id, input, now));
  if (!view) throw notFound();
  return view;
}
