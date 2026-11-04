import { handleEmailChangeCancel, handleEmailChangeRequest } from "@/lib/account/email-change";
import { apiRoute } from "@/lib/http/route";

// POST /api/account/email: asks to move the signed-in member's account to a new address (a
// confirmation link goes to it); DELETE: cancels the pending change (audit Z1-10).
export const POST = apiRoute(handleEmailChangeRequest);
export const DELETE = apiRoute(handleEmailChangeCancel);
