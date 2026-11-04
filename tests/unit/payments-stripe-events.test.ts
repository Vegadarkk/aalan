import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingAccountRecord } from "@/lib/db/repositories/billing";
import type { BillingEventDoc } from "@/lib/db/schemas";
import type * as RevenueCatApiModule from "@/lib/payments/revenuecat-api";
import type * as StripeApiModule from "@/lib/payments/stripe-api";

// Stripe webhook events (phase 7 design §7), repositories mocked: an object tagged by another
// environment sharing the test mode is dropped before any write; a refund or a dispute of a Pass
// Boutique payment (PaymentIntent metadata kind "pass", re-read from Stripe) ends the pass on a full
// refund and alerts staff otherwise; a subscription's charge is ignored.

const store = vi.hoisted(() => ({ events: new Map<string, BillingEventDoc>(), accounts: [] as BillingAccountRecord[] }));

vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));
// Hermetic: every Stripe or RevenueCat call goes through the stubs below, never the network.
vi.mock("@/lib/payments/stripe-api", async (importOriginal) => ({
  ...(await importOriginal<typeof StripeApiModule>()),
  stripeRequest: vi.fn(async () => {
    throw new Error("unexpected Stripe call");
  }),
}));
vi.mock("@/lib/payments/revenuecat-api", async (importOriginal) => ({ ...(await importOriginal<typeof RevenueCatApiModule>()), postStripeReceipt: vi.fn(async () => undefined) }));
vi.mock("@/lib/payments/billing-queue", () => ({ isBillingQueueEnabled: () => false, enqueueBillingEvent: vi.fn() }));
vi.mock("@/lib/payments/pass", () => ({ applyPassSession: vi.fn(async () => "updated"), revokePass: vi.fn(async () => "revoked") }));
vi.mock("@/lib/payments/subscriptions", () => ({ startGrace: vi.fn(async () => false), syncShopSubscription: vi.fn(async () => "unchanged") }));
vi.mock("@/lib/db/repositories/billing", () => ({
  createBillingEvent: vi.fn(async (event: BillingEventDoc) => {
    if (store.events.has(event.eventId)) return false;
    store.events.set(event.eventId, event);
    return true;
  }),
  getBillingEvent: vi.fn(async (eventId: string) => store.events.get(eventId) ?? null),
  updateBillingEvent: vi.fn(async (eventId: string, patch: Partial<BillingEventDoc>) => {
    const event = store.events.get(eventId);
    if (event) store.events.set(eventId, { ...event, ...patch });
  }),
  findBillingAccountByStripeCustomer: vi.fn(async (customer: string) => store.accounts.find((account) => account.stripeCustomerId === customer) ?? null),
  findBillingAccountByAppUserId: vi.fn(async (appUserId: string) => store.accounts.find((account) => account.rcAppUserId === appUserId) ?? null),
}));

import { alert } from "@/lib/alert";
import { resetServerEnv } from "@/lib/env";
import { createBillingEvent } from "@/lib/db/repositories/billing";
import { revokePass } from "@/lib/payments/pass";
import { passChargeAction, receiveStripeEvent } from "@/lib/payments/stripe-events";
import { syncShopSubscription } from "@/lib/payments/subscriptions";

const ACCOUNT: BillingAccountRecord = {
  id: "pro_atlas123",
  kind: "shop",
  ownerUid: "owner-uid-1",
  proId: "atlas123",
  rcAppUserId: "0b6c3f4e-2f7d-4a39-9a51-8f1d2c3b4a5e",
  stripeCustomerId: "cus_Atlas",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
};
const PASS_METADATA = { accountId: ACCOUNT.id, app_user_id: ACCOUNT.rcAppUserId, env: "dev", kind: "pass", passId: "boutique30" };

let sequence = 0;
const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_Test${(sequence += 1)}`, object: "event", type, livemode: false, created: 1_790_000_000, data: { object } });

/** Stripe's answers by path (the charge, the dispute and the PaymentIntent re-read). */
function stripeWith(objects: Record<string, unknown>) {
  return vi.fn(async (_method: string, path: string) => {
    if (!(path in objects)) throw new Error(`unexpected Stripe call ${path}`);
    return objects[path];
  }) as never;
}

beforeEach(() => {
  for (const name of ["STRIPE_SECRET_KEY", "REVENUECAT_STRIPE_PUBLIC_KEY", "REVENUECAT_SECRET_API_KEY"]) vi.stubEnv(name, "");
  resetServerEnv();
  store.events.clear();
  store.accounts = [ACCOUNT];
  vi.mocked(alert).mockClear();
  vi.mocked(createBillingEvent).mockClear();
  vi.mocked(revokePass).mockClear();
  vi.mocked(revokePass).mockResolvedValue("revoked");
  vi.mocked(syncShopSubscription).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

describe("environment of a Stripe object", () => {
  it("drops an object tagged by another environment before recording it", async () => {
    expect(await receiveStripeEvent(event("customer.subscription.updated", { id: "sub_Other", object: "subscription", customer: "cus_Other", metadata: { env: "staging" } }))).toBe("wrong_environment");
    // An invoice carries its subscription's metadata under `parent`.
    const invoice = { id: "in_Other", object: "invoice", customer: "cus_Other", parent: { type: "subscription_details", subscription_details: { subscription: "sub_Other", metadata: { env: "staging" } } } };
    expect(await receiveStripeEvent(event("invoice.paid", invoice))).toBe("wrong_environment");
    expect(createBillingEvent).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("records an object of this environment, or one with no tag", async () => {
    const stripe = stripeWith({ "/v1/subscriptions/sub_Mine": { status: "active" }, "/v1/subscriptions/sub_Untagged": { status: "active" } });
    expect(await receiveStripeEvent(event("customer.subscription.updated", { id: "sub_Mine", object: "subscription", customer: "cus_Atlas", metadata: { env: "dev" } }), { stripe })).toBe("unchanged");
    expect(await receiveStripeEvent(event("customer.subscription.updated", { id: "sub_Untagged", object: "subscription", customer: "cus_Atlas" }), { stripe })).toBe("unchanged");
    expect(createBillingEvent).toHaveBeenCalledTimes(2);
    expect(syncShopSubscription).toHaveBeenCalledTimes(2);
  });
});

describe("refunds and disputes of a Pass Boutique", () => {
  it("reads a full refund as the end of the pass, anything else as a case for staff", () => {
    expect(passChargeAction("charge.refunded", { amount: 29_900, amount_refunded: 29_900 })).toBe("revoke");
    expect(passChargeAction("charge.refunded", { amount: 29_900, amount_refunded: 10_000 })).toBe("alert");
    expect(passChargeAction("charge.refunded", { amount: 29_900 })).toBe("alert");
    expect(passChargeAction("charge.dispute.created", { amount: 29_900, amount_refunded: 29_900 })).toBe("alert");
  });

  it("ends the pass on a full refund, once the charge and its PaymentIntent are re-read", async () => {
    const stripe = stripeWith({
      "/v1/charges/ch_Pass1": { id: "ch_Pass1", payment_intent: "pi_Pass1", amount: 29_900, amount_refunded: 29_900, currency: "mad" },
      "/v1/payment_intents/pi_Pass1": { id: "pi_Pass1", customer: "cus_Atlas", metadata: PASS_METADATA },
    });
    // The payload says nothing of the pass: its charge has no metadata.
    const delivered = event("charge.refunded", { id: "ch_Pass1", object: "charge", customer: "cus_Atlas", payment_intent: "pi_Pass1", metadata: {} });
    expect(await receiveStripeEvent(delivered, { stripe })).toBe("updated");
    expect(revokePass).toHaveBeenCalledWith(expect.objectContaining({ id: ACCOUNT.id }), "pi_Pass1", expect.any(Date));
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ severity: "P1", title: expect.stringContaining("Pass Boutique remboursé (atlas123") }));
    expect(store.events.get(delivered.id)).toMatchObject({ objectId: "ch_Pass1", transactionId: "pi_Pass1", status: "processed", outcome: "updated" });
    expect(syncShopSubscription).not.toHaveBeenCalled();
  });

  it("alerts staff when the refunded pass no longer runs, and stays quiet on a refund already applied", async () => {
    const stripe = stripeWith({
      "/v1/charges/ch_Pass2": { id: "ch_Pass2", payment_intent: "pi_Pass2", amount: 29_900, amount_refunded: 29_900, currency: "mad" },
      "/v1/payment_intents/pi_Pass2": { id: "pi_Pass2", customer: "cus_Atlas", metadata: PASS_METADATA },
    });
    vi.mocked(revokePass).mockResolvedValueOnce("not_running");
    expect(await receiveStripeEvent(event("charge.refunded", { id: "ch_Pass2", object: "charge", customer: "cus_Atlas" }), { stripe })).toBe("alerted");
    expect(vi.mocked(alert).mock.calls[0]?.[0].body).toMatch(/rien n'a changé/);

    vi.mocked(alert).mockClear();
    vi.mocked(revokePass).mockResolvedValueOnce("already");
    expect(await receiveStripeEvent(event("charge.refunded", { id: "ch_Pass2", object: "charge", customer: "cus_Atlas" }), { stripe })).toBe("unchanged");
    expect(alert).not.toHaveBeenCalled();
  });

  it("alerts staff on a partial refund and on a dispute without changing the pass", async () => {
    const stripe = stripeWith({
      "/v1/charges/ch_Pass3": { id: "ch_Pass3", payment_intent: "pi_Pass3", amount: 29_900, amount_refunded: 9_900, currency: "mad" },
      "/v1/disputes/dp_Pass3": { id: "dp_Pass3", charge: "ch_Pass3", payment_intent: "pi_Pass3", amount: 29_900, currency: "mad" },
      "/v1/payment_intents/pi_Pass3": { id: "pi_Pass3", customer: "cus_Atlas", metadata: PASS_METADATA },
    });
    expect(await receiveStripeEvent(event("charge.refunded", { id: "ch_Pass3", object: "charge", customer: "cus_Atlas" }), { stripe })).toBe("alerted");
    expect(alert).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "P1", title: expect.stringContaining("Remboursement partiel") }));
    // A dispute names no customer: the PaymentIntent does.
    expect(await receiveStripeEvent(event("charge.dispute.created", { id: "dp_Pass3", object: "dispute", charge: "ch_Pass3", payment_intent: "pi_Pass3", amount: 29_900 }), { stripe })).toBe("alerted");
    expect(alert).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "P1", title: expect.stringContaining("Litige sur un Pass Boutique (atlas123") }));
    expect(revokePass).not.toHaveBeenCalled();
  });

  it("ignores a subscription's charge and another environment's pass, and alerts a pass of another account", async () => {
    const stripe = stripeWith({
      "/v1/charges/ch_Sub": { id: "ch_Sub", payment_intent: "pi_Sub", amount: 24_900, amount_refunded: 24_900 },
      "/v1/payment_intents/pi_Sub": { id: "pi_Sub", customer: "cus_Atlas", metadata: {} },
      "/v1/charges/ch_Staging": { id: "ch_Staging", payment_intent: "pi_Staging", amount: 29_900, amount_refunded: 29_900 },
      "/v1/payment_intents/pi_Staging": { id: "pi_Staging", customer: "cus_Staging", metadata: { ...PASS_METADATA, env: "staging" } },
      "/v1/charges/ch_Forged": { id: "ch_Forged", payment_intent: "pi_Forged", amount: 29_900, amount_refunded: 29_900 },
      "/v1/payment_intents/pi_Forged": { id: "pi_Forged", customer: "cus_Atlas", metadata: { ...PASS_METADATA, accountId: "pro_other999" } },
    });
    const sub = event("charge.refunded", { id: "ch_Sub", object: "charge", customer: "cus_Atlas" });
    expect(await receiveStripeEvent(sub, { stripe })).toBe("not_pass");
    expect(store.events.get(sub.id)).toMatchObject({ status: "ignored", outcome: "not_pass" });
    expect(await receiveStripeEvent(event("charge.refunded", { id: "ch_Staging", object: "charge", customer: "cus_Staging" }), { stripe })).toBe("wrong_environment");
    expect(alert).not.toHaveBeenCalled();

    expect(await receiveStripeEvent(event("charge.refunded", { id: "ch_Forged", object: "charge", customer: "cus_Atlas" }), { stripe })).toBe("unknown_customer");
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ severity: "P1", title: expect.stringContaining("pass sans boutique") }));
    expect(revokePass).not.toHaveBeenCalled();
    expect(syncShopSubscription).not.toHaveBeenCalled();
  });
});
