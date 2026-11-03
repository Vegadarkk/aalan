import { apiRoute } from "@/lib/http/route";
import { handleLogoDelete, handleLogoPut } from "@/lib/pro/handlers";

// PUT /api/pro/me/logo: the shop's logo, the image as the body; DELETE: removed (UX audit lot 3).
export const dynamic = "force-dynamic";
export const PUT = apiRoute(handleLogoPut);
export const DELETE = apiRoute(handleLogoDelete);
