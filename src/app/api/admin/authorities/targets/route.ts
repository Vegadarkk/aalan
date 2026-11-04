import { handleAuthorityTargets } from "@/lib/decisions/handlers";
import { apiRoute } from "@/lib/http/route";

// GET /api/admin/authorities/targets?q=: what a pasted link, id, e-mail, phone, name or listing
// title designates, previewed in the authority form (admin only, audit zone 7 P3-4).
export const dynamic = "force-dynamic";
export const GET = apiRoute(handleAuthorityTargets);
