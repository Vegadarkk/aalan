import { apiRoute } from "@/lib/http/route";
import { handleNewsletterUnsubscribe } from "@/lib/newsletter/handlers";

// POST /api/newsletter/unsubscribe: ?t=<token> (RFC 8058 one-click) or { token } -> 204.
// Token-authenticated: no session, no Origin check (src/lib/newsletter/handlers.ts).
export const dynamic = "force-dynamic";
export const POST = apiRoute((request) => handleNewsletterUnsubscribe(request));
