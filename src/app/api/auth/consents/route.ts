import { handleConsents } from "@/lib/auth/consents";
import { apiRoute } from "@/lib/http/route";

// POST /api/auth/consents: CGU acceptance after a change, or the change notice shown (D11).
export const POST = apiRoute(handleConsents);
