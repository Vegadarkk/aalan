import { apiRoute } from "@/lib/http/route";
import { handleNewsletterSubscribe } from "@/lib/newsletter/handlers";

// POST /api/newsletter/subscribe: the door's sign-up form (src/lib/newsletter/handlers.ts).
export const dynamic = "force-dynamic";
export const POST = apiRoute(handleNewsletterSubscribe);
