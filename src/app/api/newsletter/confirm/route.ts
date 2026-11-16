import { apiRoute } from "@/lib/http/route";
import { handleNewsletterConfirm } from "@/lib/newsletter/handlers";

// POST /api/newsletter/confirm { token } -> 204. Token-authenticated; GET is not exported (405), so
// a link prefetch never confirms (src/lib/newsletter/handlers.ts).
export const dynamic = "force-dynamic";
export const POST = apiRoute((request) => handleNewsletterConfirm(request));
