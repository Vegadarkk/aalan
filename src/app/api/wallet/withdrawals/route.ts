import { handleRequestWithdrawal, handleWithdrawals } from "@/lib/payments/handlers";
import { apiRoute } from "@/lib/http/route";

// GET /api/wallet/withdrawals: packs that can be withdrawn and past receipts; POST: withdraws from one (CGV §6).
export const dynamic = "force-dynamic";
export const GET = apiRoute((request) => handleWithdrawals(request));
export const POST = apiRoute((request) => handleRequestWithdrawal(request));
