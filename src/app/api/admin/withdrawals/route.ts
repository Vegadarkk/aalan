import { requireStaff } from "@/lib/auth/guards";
import { markWithdrawalRefundedSchema, type AdminWithdrawalView } from "@/lib/contracts/payments";
import { readJson } from "@/lib/http/json";
import { apiRoute, json } from "@/lib/http/route";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { markWithdrawalRefunded, pendingWithdrawals } from "@/lib/payments/withdrawals";

// Withdrawals from credit packs waiting for their refund (admins only): GET lists them, POST records
// that an admin refunded one in Stripe (the order is closed, nothing is debited again).

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request) => {
  const staff = await requireStaff(request, { roles: ["admin"] });
  await enforceLimit("admin.read.uid", staff.user.uid);
  return json<AdminWithdrawalView[]>(await pendingWithdrawals());
});

export const POST = apiRoute(async (request) => {
  const staff = await requireStaff(request, { mutation: true, roles: ["admin"] });
  const body = await readJson(request, markWithdrawalRefundedSchema);
  return json<AdminWithdrawalView[]>(await markWithdrawalRefunded(staff, body));
});
