import { apiRoute } from "@/lib/http/route";
import { handleHolidayAgency } from "@/lib/pro/handlers";

// PUT /api/pro/me/holiday: the holiday rental agency's settings (audit L4-02).
export const dynamic = "force-dynamic";
export const PUT = apiRoute(handleHolidayAgency);
