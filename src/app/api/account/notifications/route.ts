import { handleNotificationsRead, handleNotificationsUpdate } from "@/lib/account/notifications";
import { apiRoute } from "@/lib/http/route";

// GET and POST /api/account/notifications: the signed-in member's e-mail preferences (audit B2).
export const GET = apiRoute(handleNotificationsRead);
export const POST = apiRoute(handleNotificationsUpdate);
