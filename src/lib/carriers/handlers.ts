import "server-only";
import { requireUser } from "@/lib/auth/guards";
import { applyDevice, applyTurnstilePass, deviceOf, jsonResponse } from "@/lib/auth/respond";
import { departureCreateSchema, departureEditSchema, departureSpaceSchema, type DepartureResponse } from "@/lib/contracts/departures";
import { notFound } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { json } from "@/lib/http/route";
import { isListingId } from "@/lib/listings/ids";
import { assertQuotas, DEPOSIT_QUOTAS } from "@/lib/quota/gate";
import { requestIdentity } from "@/lib/rate-limit/keys";
import { consumeLimit, enforceLimit } from "@/lib/rate-limit/limiter";
import { createDepartures, editDeparture, listDepartures, updateDepartureSpace } from "./departures";

// Route handlers of /api/pro/departures/** (« Mes départs », transporteurs/spec.md §4): the listing
// limiters of the same actions (owner reads, publications, edits, one-tap stock), the deposit
// quotas gate on every write, the owner check in the service (404 for someone else's departure).

type Params = Promise<Record<string, string | string[] | undefined>>;

async function idOf(params: Params): Promise<string> {
  const { id } = await params;
  if (typeof id !== "string" || !isListingId(id)) throw notFound();
  return id;
}

const actorOf = (request: Request, auth: Awaited<ReturnType<typeof requireUser>>) => ({ auth, ip: requestIdentity(request.headers).ip });

/** GET /api/pro/departures: charged like « Mes annonces », a document per departure read. */
export async function handleDepartures(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  await enforceLimit("listing.owner.read.uid", auth.user.uid);
  const body = await listDepartures(auth);
  const read = body.upcoming.length + body.past.length;
  if (read > 1) await consumeLimit("listing.owner.read.uid", auth.user.uid, read - 1);
  return json(body);
}

/** POST /api/pro/departures: a departure or a recurrence, each departure a publication. */
export async function handleDepartureCreate(request: Request): Promise<Response> {
  const auth = await requireUser(request, { mutation: true });
  const input = await readJson(request, departureCreateSchema);
  await enforceLimit("listing.publish.pro.uid", auth.user.uid, input.repeat?.count ?? 1);
  await assertQuotas(DEPOSIT_QUOTAS);
  const device = deviceOf(request);
  const outcome = await createDepartures(actorOf(request, auth), request, input, device);
  const response = applyDevice(jsonResponse(outcome.body), device);
  return outcome.turnstilePassed ? applyTurnstilePass(response, device) : response;
}

/** PUT /api/pro/departures/{id}: new facts (counted as a listing edit by the listing service). */
export async function handleDepartureEdit(request: Request, params: Params): Promise<Response> {
  const auth = await requireUser(request, { mutation: true });
  const id = await idOf(params);
  const input = await readJson(request, departureEditSchema);
  await assertQuotas(DEPOSIT_QUOTAS);
  const body: DepartureResponse = { departure: await editDeparture(actorOf(request, auth), id, input) };
  return json(body);
}

/** PUT /api/pro/departures/{id}/space: the room left, one tap (the stock's budget). */
export async function handleDepartureSpace(request: Request, params: Params): Promise<Response> {
  const auth = await requireUser(request, { mutation: true });
  const id = await idOf(params);
  const input = await readJson(request, departureSpaceSchema);
  await enforceLimit("listing.stock.uid", auth.user.uid);
  await assertQuotas(DEPOSIT_QUOTAS);
  const body: DepartureResponse = { departure: await updateDepartureSpace(actorOf(request, auth), id, input) };
  return json(body);
}
