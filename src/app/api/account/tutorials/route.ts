import { handleTutorialsRead, handleTutorialsUpdate } from "@/lib/account/tutorials";
import { apiRoute } from "@/lib/http/route";

// GET and POST /api/account/tutorials: the signed-in member's guided tours (owner, 2026-11-11).
export const GET = apiRoute(handleTutorialsRead);
export const POST = apiRoute(handleTutorialsUpdate);
