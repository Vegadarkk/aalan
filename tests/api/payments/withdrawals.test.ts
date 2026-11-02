import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as RuntimeModule from "@/lib/config/runtime";
import type * as RevenueCatApiModule from "@/lib/payments/revenuecat-api";
import type { RevenueCatPurchase } from "@/lib/payments/revenuecat-api";

// Withdrawal from a credit pack (CGV §6) and partial refunds: the unspent credits of a pack (spent
// oldest first) leave the wallet at the request with a receipt and an e-mail; the RevenueCat refund
// that follows debits nothing more; an admin closes it after a Stripe refund; a shop has no
// withdrawal; a refund event for less than the price debits the same share of the pack.

const flags = vi.hoisted(() => ({ salesEnabled: true, proSignupEnabled: true, paymentInstallmentsEnabled: false }));
const store = vi.hoisted(() => ({ purchases: [] as RevenueCatPurchase[] }));
vi.mock("@/lib/config/runtime", async (importOriginal) => ({ ...(await importOriginal<typeof RuntimeModule>()), getFlags: vi.fn(async () => ({ ...flags })) }));
vi.mock("@/lib/payments/revenuecat-api", async (importOriginal) => ({ ...(await importOriginal<typeof RevenueCatApiModule>()), listCustomerPurchases: vi.fn(async () => store.purchases) }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: vi.fn(async () => ({ ok: true, codes: [] })) }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));

import { POST as webhook } from "@/app/api/webhooks/revenuecat/route";
import { POST as checkout } from "@/app/api/wallet/packs/route";
import { GET as listWithdrawals, POST as withdraw } from "@/app/api/wallet/withdrawals/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { CheckoutPackResponse, WithdrawalReceiptView, WithdrawalsResponse } from "@/lib/contracts/payments";
import { alert } from "@/lib/alert";
import type { StaffContext } from "@/lib/auth/guards";
import { getOrder, orderRef } from "@/lib/db/repositories/billing";
import { getWallet, ledgerRef, setWallet } from "@/lib/db/repositories/wallets";
import { resetServerEnv } from "@/lib/env";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import { sendMail } from "@/lib/mail";
import { expectedSignature } from "@/lib/payments/revenuecat-webhook";
import { packLines } from "@/lib/payments/sales";
import { markWithdrawalRefunded, pendingWithdrawals } from "@/lib/payments/withdrawals";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { api, DAY_MS, member, type ErrorBody, type Member } from "../listings/helpers";

const AUTH = "Bearer rc-test-authorization";
const SECRET = "rc-test-signing-secret";
const VARS = { REVENUECAT_PURCHASE_LINK: "https://pay.rev.cat/sandbox-token", REVENUECAT_WEBHOOK_AUTH: AUTH, REVENUECAT_WEBHOOK_HMAC_SECRET: SECRET, REVENUECAT_PROJECT_ID: "proj-test", REVENUECAT_SECRET_API_KEY: "sk-test" };

beforeAll(() => {
  Object.assign(process.env, VARS);
  resetServerEnv();
});
afterAll(() => {
  for (const name of Object.keys(VARS)) delete process.env[name];
  resetServerEnv();
});
beforeEach(() => {
  resetRateLimiters();
  store.purchases = [];
  vi.mocked(alert).mockClear();
  vi.mocked(sendMail).mockClear();
});

const code = (body: unknown) => (body as ErrorBody).error.code;

async function appUserIdOf(buyer: Member): Promise<string> {
  const result = await api<CheckoutPackResponse>(checkout, "POST", "/api/wallet/packs", { member: buyer, body: { packId: "mad_100", expectedPriceMinor: 10_000, acceptTerms: true, turnstileToken: "dev" } });
  expect(result.status).toBe(200);
  return decodeURIComponent(new URL(result.body.url).pathname.split("/").pop()!);
}

function rcEvent(type: string, appUserId: string, transactionId: string, price: number) {
  return {
    api_version: "1.0",
    event: {
      id: randomUUID(),
      type,
      environment: "SANDBOX",
      app_user_id: appUserId,
      original_app_user_id: appUserId,
      product_id: "aalan_credits_100_mad",
      transaction_id: transactionId,
      store: "RC_BILLING",
      currency: "MAD",
      price_in_purchased_currency: price,
      country_code: "MA",
      event_timestamp_ms: Date.now(),
    },
  };
}

async function deliver(envelope: unknown) {
  const raw = JSON.stringify(envelope);
  const t = Math.floor(Date.now() / 1000);
  return api<ErrorBody>(webhook, "POST", "/api/webhooks/revenuecat", { body: envelope, origin: null, headers: { authorization: AUTH, "x-revenuecat-webhook-signature": `t=${t},v1=${expectedSignature(SECRET, t, raw)}` } });
}

const purchase = (transactionId: string, status = "owned"): RevenueCatPurchase => ({ id: `rcp_${transactionId}`, storePurchaseIdentifier: transactionId, status, environment: "sandbox", quantity: 1 });

/** Buys the 100 MAD pack (100 + 10 credits) and answers its transaction id. */
async function buy(buyer: Member, appUserId: string): Promise<string> {
  const transactionId = `txn_${randomUUID()}`;
  store.purchases = [...store.purchases, purchase(transactionId)];
  expect((await deliver(rcEvent("NON_RENEWING_PURCHASE", appUserId, transactionId, 100))).status).toBe(200);
  return transactionId;
}

async function spendTo(uid: string, balance: number): Promise<void> {
  const now = new Date();
  await setWallet(uid, { balance, frozen: false, planCredits: 0, allowances: { featured: 0 }, createdAt: now, updatedAt: now });
}

const view = (buyer: Member) => api<WithdrawalsResponse>(listWithdrawals, "GET", "/api/wallet/withdrawals", { member: buyer });
const send = (buyer: Member, orderId: string, extra: Record<string, unknown> = {}) =>
  api<WithdrawalReceiptView & ErrorBody>(withdraw, "POST", "/api/wallet/withdrawals", { member: buyer, body: { orderId, confirm: true, locale: "fr", ...extra } });

const staff = { user: { uid: "admin-test" }, role: "admin" } as unknown as StaffContext;

describe("withdrawal from a credit pack", () => {
  it("removes the unspent credits at once, acknowledges, and the RevenueCat refund debits nothing more", async () => {
    const buyer = await member();
    const appUserId = await appUserIdOf(buyer);
    const transactionId = await buy(buyer, appUserId);
    await spendTo(buyer.uid, 90);

    const listed = await view(buyer);
    expect(listed.status).toBe(200);
    expect(listed.body.eligible).toBe(true);
    // 90 unspent of 110: 82 paid + 8 bonus; 82 % of the 100 MAD paid.
    expect(listed.body.packs).toEqual([expect.objectContaining({ orderId: transactionId, packCredits: 110, removableCredits: 90, currency: "MAD", refundMinor: 8_200 })]);

    expect((await send(buyer, transactionId, { confirm: false })).status).toBe(400);
    const sent = await send(buyer, transactionId);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ orderId: transactionId, status: "requested", packCredits: 110, removedCredits: 90, refundMinor: 8_200, currency: "MAD" });
    expect(sent.body.receipt).toMatch(/^R-\d{8}-[A-Z0-9]{6}$/);
    expect(await getWallet(buyer.uid)).toMatchObject({ balance: 0, frozen: false });
    expect((await ledgerRef(buyer.uid, `withdrawal_${transactionId}`).get()).data()).toMatchObject({ reason: "withdrawal", delta: -90, paidPart: -82, bonusPart: -8, balanceAfter: 0, actorUid: buyer.uid });
    expect(await getOrder(transactionId)).toMatchObject({ status: "paid", withdrawal: { status: "requested", credits: { paid: 82, bonus: 8 }, refundMinor: 8_200, requestedBy: buyer.uid } });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ template: "withdrawalReceipt", priority: "transactional", data: expect.objectContaining({ receipt: sent.body.receipt, refundMinor: 8_200, removedCredits: 90 }) }));
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ severity: "P2", title: expect.stringContaining(sent.body.receipt) }));

    // Once only.
    const again = await send(buyer, transactionId);
    expect(again.status).toBe(409);
    expect(code(again.body)).toBe("withdrawal_exists");
    expect((await view(buyer)).body).toMatchObject({ packs: [], receipts: [{ receipt: sent.body.receipt, status: "requested" }] });
    expect((await pendingWithdrawals()).map((item) => item.orderId)).toContain(transactionId);

    // The whole purchase refunded from RevenueCat: no second debit, and an alert for the excess.
    vi.mocked(alert).mockClear();
    store.purchases = [purchase(transactionId, "refunded")];
    expect((await deliver(rcEvent("CANCELLATION", appUserId, transactionId, -100))).status).toBe(200);
    expect((await getWallet(buyer.uid))?.balance).toBe(0);
    expect(await getOrder(transactionId)).toMatchObject({ status: "refunded", refundedMinor: 10_000, refundedCredits: { paid: 82, bonus: 8 }, withdrawal: { status: "refunded", refundedBy: "system" } });
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("au-delà") }));
    expect((await pendingWithdrawals()).map((item) => item.orderId)).not.toContain(transactionId);
  });

  it("closes a withdrawal an admin refunded in Stripe; the late RevenueCat event changes nothing", async () => {
    const buyer = await member();
    const appUserId = await appUserIdOf(buyer);
    const transactionId = await buy(buyer, appUserId);
    expect((await send(buyer, transactionId)).body).toMatchObject({ removedCredits: 110, refundMinor: 10_000 });

    await markWithdrawalRefunded(staff, { orderId: transactionId, stripeRefundId: "re_3TestRefund01" });
    const closed = await getOrder(transactionId);
    expect(closed).toMatchObject({ status: "refunded", refundedMinor: 10_000, withdrawal: { status: "refunded", refundedBy: "admin-test", stripeRefundId: "re_3TestRefund01" } });
    // A second click is a no-op.
    await markWithdrawalRefunded(staff, { orderId: transactionId });
    expect((await getOrder(transactionId))?.withdrawal?.stripeRefundId).toBe("re_3TestRefund01");

    store.purchases = [purchase(transactionId, "refunded")];
    expect((await deliver(rcEvent("CANCELLATION", appUserId, transactionId, -100))).status).toBe(200);
    expect((await getWallet(buyer.uid))?.balance).toBe(0);
    expect((await getOrder(transactionId))?.refundedAt?.getTime()).toBe(closed?.refundedAt?.getTime());

    // The tax register: one sale, one refund of its amount.
    const lines = packLines({ id: transactionId, ...(await getOrder(transactionId))! }, DEFAULT_PRICING, { label: "t", from: new Date(0), to: new Date(Date.now() + DAY_MS) });
    expect(lines.map((line) => [line.movement, line.grossMinor])).toEqual([
      ["sale", 10_000],
      ["refund", -10_000],
    ]);
  });

  it("counts credits as spent oldest first", async () => {
    const buyer = await member();
    const appUserId = await appUserIdOf(buyer);
    const first = await buy(buyer, appUserId);
    // Distinct purchase dates: the second pack is the newer one.
    await orderRef(first).update({ purchasedAt: new Date(Date.now() - DAY_MS) });
    const second = await buy(buyer, appUserId);
    await spendTo(buyer.uid, 70);

    const listed = await view(buyer);
    expect(Object.fromEntries(listed.body.packs.map((pack) => [pack.orderId, pack.removableCredits]))).toEqual({ [first]: 0, [second]: 70 });
    const none = await send(buyer, first);
    expect(none.status).toBe(409);
    expect(code(none.body)).toBe("withdrawal_nothing_left");
    expect((await send(buyer, second)).body).toMatchObject({ removedCredits: 70 });
    expect((await getWallet(buyer.uid))?.balance).toBe(0);
  });

  it("refuses a pack past 14 days, someone else's order and a shop's wallet", async () => {
    const buyer = await member();
    const appUserId = await appUserIdOf(buyer);
    const transactionId = await buy(buyer, appUserId);

    const stranger = await member();
    expect((await send(stranger, transactionId)).status).toBe(404);

    await orderRef(transactionId).update({ purchasedAt: new Date(Date.now() - 15 * DAY_MS) });
    expect((await view(buyer)).body.packs).toEqual([]);
    const late = await send(buyer, transactionId);
    expect(late.status).toBe(409);
    expect(code(late.body)).toBe("withdrawal_expired");

    const owner = await member();
    await setClaims(owner.uid, { role: "pro", proId: "shpw2345", proRole: "owner" });
    const minted = await createSessionForUid(owner.uid);
    owner.jar.cookies.set("__Host-session", minted.cookie);
    owner.jar.cookies.set("__Host-csrf", csrfToken(minted.cookie));
    expect((await view(owner)).body).toEqual({ eligible: false, packs: [], receipts: [] });
    const shop = await send(owner, transactionId);
    expect(shop.status).toBe(403);
    expect(code(shop.body)).toBe("withdrawal_not_consumer");
  });
});

describe("partial refund", () => {
  it("debits the share of the pack matching the amount refunded", async () => {
    const buyer = await member();
    const appUserId = await appUserIdOf(buyer);
    const transactionId = await buy(buyer, appUserId);
    store.purchases = [purchase(transactionId, "refunded")];
    expect((await deliver(rcEvent("CANCELLATION", appUserId, transactionId, -50))).status).toBe(200);
    expect(await getWallet(buyer.uid)).toMatchObject({ balance: 55, frozen: false });
    expect(await getOrder(transactionId)).toMatchObject({ status: "refunded", refundedMinor: 5_000, refundedCredits: { paid: 50, bonus: 5 } });
    expect((await ledgerRef(buyer.uid, `refund_${transactionId}`).get()).data()).toMatchObject({ reason: "refund", delta: -55, paidPart: -50, bonusPart: -5 });
  });
});
