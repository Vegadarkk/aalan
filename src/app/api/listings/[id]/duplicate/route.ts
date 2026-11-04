import { handleDuplicate } from "@/lib/listings/handlers";
import { apiRoute } from "@/lib/http/route";

// POST /api/listings/{id}/duplicate (Pros, audit §7): 201 { id } of the new draft.
export const dynamic = "force-dynamic";
export const POST = apiRoute((request, context) => handleDuplicate(request, context.params));
