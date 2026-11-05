import { handleAvatarDelete, handleAvatarPut } from "@/lib/account/avatar";
import { apiRoute } from "@/lib/http/route";

// PUT /api/account/avatar: the member's profile photo, the image as the body; DELETE: removed (audit §7).
export const dynamic = "force-dynamic";
export const PUT = apiRoute(handleAvatarPut);
export const DELETE = apiRoute(handleAvatarDelete);
