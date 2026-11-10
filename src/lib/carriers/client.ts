import { apiGet, apiPost, apiPut } from "@/lib/auth/client";
import { DEPARTURE_API, type DepartureCreateInput, type DepartureCreateResponse, type DepartureEditInput, type DepartureResponse, type DeparturesResponse, type DepartureSpaceInput } from "@/lib/contracts/departures";

// Browser side of /api/pro/departures (« Mes départs »). Pause, resume and removal are the listing's
// own actions (src/lib/listings/client/api.ts).

export const loadDepartures = () => apiGet<DeparturesResponse>(DEPARTURE_API.list);
export const createDepartures = (input: DepartureCreateInput) => apiPost<DepartureCreateResponse>(DEPARTURE_API.list, input);
export const editDeparture = (id: string, input: DepartureEditInput) => apiPut<DepartureResponse>(DEPARTURE_API.one(id), input);
export const saveDepartureSpace = (id: string, input: DepartureSpaceInput) => apiPut<DepartureResponse>(DEPARTURE_API.space(id), input);
