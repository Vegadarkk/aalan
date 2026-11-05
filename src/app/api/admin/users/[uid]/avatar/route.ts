import { handleStaffAvatarRemove } from "@/lib/account/avatar";
import { apiRoute } from "@/lib/http/route";

// DELETE /api/admin/users/{uid}/avatar: a moderator removes the profile photo (statement of reasons).
export const dynamic = "force-dynamic";
export const DELETE = apiRoute(handleStaffAvatarRemove);
