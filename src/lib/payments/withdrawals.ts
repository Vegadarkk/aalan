import "server-only";
import { randomInt } from "node:crypto";
import type { PricingConfig } from "@/config/pricing";
import { alert } from "@/lib/alert";
import { audit } from "@/lib/audit";
import type { AuthContext, StaffContext } from "@/lib/auth/guards";
import { getPricing } from "@/lib/config/runtime";
import {
  WITHDRAWAL_DAYS,
  WITHDRAWAL_REFUND_DAYS,
  WITHDRAWAL_STATEMENT_VERSION,
  type AdminWithdrawalView,
  type MarkWithdrawalRefundedInput,
  type RequestWithdrawalInput,
  type WithdrawablePackView,
  type WithdrawalReceiptView,
  type WithdrawalsResponse,
} from "@/lib/contracts/payments";
import { getOrderTx, listAccountOrders, listAccountOrdersTx, listPendingWithdrawals, setOrderTx, type OrderRecord } from "@/lib/db/repositories/billing";
import { getWallet, getWalletTx, recordWalletOperationTx, walletStateAt } from "@/lib/db/repositories/wallets";
import type { OrderDoc } from "@/lib/db/schemas";
import { db } from "@/lib/firebase/admin";
import { HttpError, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/logging/logger";
import { sendMail } from "@/lib/mail";
import { memberBillingAccount } from "./options";
import { orderGrossMinor } from "./sales";
import { splitUnspent, unspentOfPack, withdrawPurchase, type HeldPack, type PackCredits } from "./wallet";

// Withdrawal from a credit pack (CGV §6; phase 7 design §5): a consumer withdraws online within
// WITHDRAWAL_DAYS of the purchase. In one transaction the pack's unspent credits leave the wallet
// (purchased credits are spent oldest first) and the order records the withdrawal with its
// receipt number; the buyer gets the acknowledgement by e-mail (durable medium) and on the page.
// RevenueCat refunds only whole purchases: an admin refunds the paid share in Stripe and marks it
// refunded in the back office; a RevenueCat refund event that comes later debits nothing more
// (src/lib/payments/revenuecat-events.ts). A shop's wallet has no withdrawal (Pros are not consumers).

const DAY_MS = 86_400_000;
const RECEIPT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function receiptNumber(now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Array.from({ length: 6 }, () => RECEIPT_ALPHABET[randomInt(RECEIPT_ALPHABET.length)]).join("");
  return `R-${day}-${suffix}`;
}

const total = (credits: PackCredits) => credits.paid + credits.bonus;

/** Credits an order no longer holds: its withdrawal, its refund (all of it when the share is unknown). */
function removedOf(order: OrderDoc): number {
  if (order.withdrawal) return total(order.withdrawal.credits);
  if (order.status === "refunded") return order.refundedCredits ? total(order.refundedCredits) : total(order.credits);
  return 0;
}

function heldPack(order: OrderRecord): HeldPack {
  return { id: order.id, credits: order.credits, removed: removedOf(order), purchasedAt: order.purchasedAt };
}

/** The paid share of `part` in the currency charged, rounded to the nearest minor unit. */
export function refundMinorOf(order: Pick<OrderDoc, "amountMinor" | "packId" | "quantity" | "credits">, part: PackCredits, pricing: PricingConfig): number {
  if (order.credits.paid <= 0 || part.paid <= 0) return 0;
  return Math.round((orderGrossMinor(order, pricing) * Math.min(part.paid, order.credits.paid)) / order.credits.paid);
}

function withdrawableUntil(order: Pick<OrderDoc, "purchasedAt">): Date {
  return new Date(order.purchasedAt.getTime() + WITHDRAWAL_DAYS * DAY_MS);
}

function isWithdrawable(order: OrderDoc, now: Date): boolean {
  return order.status === "paid" && !order.withdrawal && now.getTime() < withdrawableUntil(order).getTime();
}

function receiptView(order: OrderRecord): WithdrawalReceiptView | null {
  const w = order.withdrawal;
  if (!w) return null;
  return {
    receipt: w.receipt,
    orderId: order.id,
    status: w.status,
    requestedAt: w.requestedAt.toISOString(),
    packCredits: total(order.credits),
    removedCredits: total(w.credits),
    currency: order.currency,
    refundMinor: w.refundMinor,
    refundBy: new Date(w.requestedAt.getTime() + WITHDRAWAL_REFUND_DAYS * DAY_MS).toISOString(),
    refundedAt: w.refundedAt?.toISOString() ?? null,
  };
}

function personalAccount(auth: AuthContext): string | null {
  const { accountId, kind } = memberBillingAccount(auth);
  return kind === "personal" ? accountId : null;
}

/** GET /api/wallet/withdrawals: the packs that can be withdrawn now (with what it removes and refunds) and past receipts. */
export async function withdrawalsView(auth: AuthContext, now = new Date()): Promise<WithdrawalsResponse> {
  const accountId = personalAccount(auth);
  if (!accountId) return { eligible: false, packs: [], receipts: [] };
  const [orders, wallet, pricing] = await Promise.all([listAccountOrders(accountId), getWallet(accountId), getPricing()]);
  const balance = walletStateAt(wallet, now).balance;
  const held = orders.map(heldPack);
  const packs: WithdrawablePackView[] = orders
    .filter((order) => isWithdrawable(order, now))
    .sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime())
    .map((order) => {
      const part = splitUnspent(order.credits, unspentOfPack(balance, heldPack(order), held));
      return {
        orderId: order.id,
        purchasedAt: order.purchasedAt.toISOString(),
        until: withdrawableUntil(order).toISOString(),
        packCredits: total(order.credits),
        removableCredits: total(part),
        currency: order.currency,
        refundMinor: refundMinorOf(order, part, pricing),
      };
    });
  const receipts = orders
    .flatMap((order) => receiptView(order) ?? [])
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, 20);
  return { eligible: true, packs, receipts };
}

/** POST /api/wallet/withdrawals: withdraws from one pack; answers the receipt (also sent by e-mail). */
export async function requestWithdrawal(auth: AuthContext, input: RequestWithdrawalInput, now = new Date()): Promise<WithdrawalReceiptView> {
  const accountId = personalAccount(auth);
  if (!accountId) throw new HttpError(403, "withdrawal_not_consumer");
  const pricing = await getPricing();

  const order = await db().runTransaction(async (tx): Promise<OrderRecord> => {
    const current = await getOrderTx(tx, input.orderId);
    // Someone else's order reads as missing (no IDOR).
    if (!current || current.accountId !== accountId) throw notFound();
    if (current.withdrawal) throw new HttpError(409, "withdrawal_exists");
    if (current.status !== "paid") throw new HttpError(409, "withdrawal_refunded");
    if (!isWithdrawable(current, now)) throw new HttpError(409, "withdrawal_expired");
    const [orders, before] = await Promise.all([listAccountOrdersTx(tx, accountId), getWalletTx(tx, accountId)]);
    const state = walletStateAt(before, now);
    const target: OrderRecord = { id: input.orderId, ...current };
    const part = splitUnspent(current.credits, unspentOfPack(state.balance, heldPack(target), orders.map(heldPack)));
    if (total(part) === 0) throw new HttpError(409, "withdrawal_nothing_left");
    const { wallet, ledger } = withdrawPurchase(state, part);
    recordWalletOperationTx(tx, accountId, `withdrawal_${input.orderId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180)}`, {
      before,
      state: wallet,
      ledger,
      entry: { price: part.paid, refs: { orderId: input.orderId }, taxJurisdiction: current.taxJurisdiction, actorUid: auth.user.uid, at: now },
      now,
    });
    const updated: OrderDoc = {
      ...current,
      withdrawal: {
        receipt: receiptNumber(now),
        status: "requested",
        requestedAt: now,
        requestedBy: auth.user.uid,
        credits: part,
        refundMinor: refundMinorOf(current, part, pricing),
        statementVersion: WITHDRAWAL_STATEMENT_VERSION,
      },
      updatedAt: now,
    };
    setOrderTx(tx, input.orderId, updated);
    return { id: input.orderId, ...updated };
  });

  const receipt = receiptView(order)!;
  logger.info({ orderId: order.id, receipt: receipt.receipt }, "withdrawal requested");
  await audit({ actorUid: auth.user.uid, actorRole: "individual", action: "billing.withdrawal.requested", target: { type: "order", id: order.id.slice(0, 128) }, automated: false, reason: receipt.receipt, at: now }).catch(
    (error: unknown) => logger.error({ orderId: order.id, err: (error as Error).message }, "withdrawal audit failed"),
  );
  if (auth.user.email) {
    await sendMail({
      template: "withdrawalReceipt",
      locale: input.locale ?? "fr",
      to: auth.user.email,
      priority: "transactional",
      idempotencyKey: `withdrawalReceipt-${receipt.receipt}`,
      data: { displayName: null, receipt: receipt.receipt, requestedAt: receipt.requestedAt, packCredits: receipt.packCredits, removedCredits: receipt.removedCredits, refundMinor: receipt.refundMinor, currency: receipt.currency, refundBy: receipt.refundBy },
    }).catch((error: unknown) => logger.error({ orderId: order.id, err: (error as Error).message }, "withdrawal receipt mail failed"));
  }
  await alert({
    severity: "P2",
    title: `Rétractation à rembourser (${receipt.receipt})`,
    body: `Commande ${order.id} : rembourser ${(receipt.refundMinor / 100).toFixed(2)} ${receipt.currency} dans Stripe (remboursement partiel du paiement du pack) au plus tard le ${receipt.refundBy.slice(0, 10)}, puis « Marquer remboursé » dans Ventes.`,
  }).catch(() => undefined);
  return receipt;
}

/** The back office's list: withdrawals waiting for their refund, oldest first. */
export async function pendingWithdrawals(): Promise<AdminWithdrawalView[]> {
  return (await listPendingWithdrawals()).flatMap((order) => {
    const w = order.withdrawal;
    if (!w) return [];
    return [
      {
        orderId: order.id,
        receipt: w.receipt,
        accountId: order.accountId,
        requestedAt: w.requestedAt.toISOString(),
        refundBy: new Date(w.requestedAt.getTime() + WITHDRAWAL_REFUND_DAYS * DAY_MS).toISOString(),
        currency: order.currency,
        refundMinor: w.refundMinor,
        removedCredits: total(w.credits),
        packId: order.packId,
        environment: order.environment,
      },
    ];
  });
}

/** An admin refunded the paid share (in Stripe): the order and its withdrawal are closed, nothing is debited again. */
export async function markWithdrawalRefunded(staff: StaffContext, input: MarkWithdrawalRefundedInput, now = new Date()): Promise<AdminWithdrawalView[]> {
  await db().runTransaction(async (tx) => {
    const order = await getOrderTx(tx, input.orderId);
    if (!order?.withdrawal) throw notFound();
    if (order.withdrawal.status === "refunded") return;
    setOrderTx(tx, input.orderId, closeWithdrawal(order, { at: now, by: staff.user.uid, ...(input.stripeRefundId ? { stripeRefundId: input.stripeRefundId } : {}) }));
  });
  await audit({ actorUid: staff.user.uid, actorRole: staff.role, action: "billing.withdrawal.refunded", target: { type: "order", id: input.orderId.slice(0, 128) }, automated: false, ...(input.stripeRefundId ? { reason: input.stripeRefundId } : {}), at: now });
  return pendingWithdrawals();
}

/**
 * The order once the withdrawal's refund is done (by an admin, or seen in a RevenueCat refund
 * event): refunded for the withdrawal's credits and amount (`refundedMinor` when the event says more).
 */
export function closeWithdrawal(order: OrderDoc, close: { at: Date; by: string; stripeRefundId?: string; refundEventId?: string; refundedMinor?: number }): OrderDoc {
  const w = order.withdrawal!;
  return {
    ...order,
    status: "refunded",
    refundedAt: close.at,
    refundedMinor: close.refundedMinor ?? w.refundMinor,
    refundedCredits: w.credits,
    ...(close.refundEventId ? { refundEventId: close.refundEventId } : {}),
    withdrawal: { ...w, status: "refunded", refundedAt: close.at, refundedBy: close.by, ...(close.stripeRefundId ? { stripeRefundId: close.stripeRefundId } : {}) },
    updatedAt: close.at,
  };
}

/** Withdrawals still unrefunded `days` after their request (the nightly reconciliation alerts on them). */
export async function overdueWithdrawals(now: Date, days = WITHDRAWAL_REFUND_DAYS - 4): Promise<AdminWithdrawalView[]> {
  const limit = now.getTime() - days * DAY_MS;
  return (await pendingWithdrawals()).filter((view) => new Date(view.requestedAt).getTime() <= limit);
}
