import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "@/config/pricing";
import { walletStateAt } from "@/lib/db/repositories/wallets";
import type { WalletDoc } from "@/lib/db/schemas";
import { launchGiftEnd, launchPlaceDecision, launchPlaceMarkerPurgeAt, type LaunchPlaceFacts } from "@/lib/payments/launch-place";
import { optionsOpen } from "@/lib/payments/options";
import { EMPTY_WALLET, grantLaunchGift, spendOption, withdrawPurchase } from "@/lib/payments/wallet";

// Launch places of individuals (owner, 2026-11-11): 1,000 places shared with the shops, 30 gift
// credits valid 90 days once a listing passed moderation and the phone is verified, one place per
// account and per number, spendable on options while sales are closed.

const offer = DEFAULT_PRICING.launchOffer;
const now = new Date("2026-12-14T09:00:00.000Z");

function facts(extra: Partial<LaunchPlaceFacts> = {}): LaunchPlaceFacts {
  return {
    offer,
    now,
    granted: 10,
    user: { type: "individual", status: "active" },
    hasPublished: true,
    phoneE164: "+212612345678",
    alreadyGranted: false,
    phoneUsed: false,
    ...extra,
  };
}

describe("launch place decision", () => {
  it("grants a place when every condition holds", () => {
    expect(launchPlaceDecision(facts())).toBe("granted");
  });

  it("gives nothing once places are closed, given out, or the offer gives no credits", () => {
    expect(launchPlaceDecision(facts({ now: new Date("2027-03-13T00:00:00.000Z") }))).toBe("closed");
    expect(launchPlaceDecision(facts({ offer: { ...offer, active: false } }))).toBe("closed");
    expect(launchPlaceDecision(facts({ offer: { ...offer, individual: { ...offer.individual, credits: 0 } } }))).toBe("closed");
    expect(launchPlaceDecision(facts({ granted: 1_000 }))).toBe("full");
    expect(launchPlaceDecision(facts({ granted: 999 }))).toBe("granted");
  });

  it("gives one place per account and per phone number", () => {
    expect(launchPlaceDecision(facts({ alreadyGranted: true }))).toBe("already");
    expect(launchPlaceDecision(facts({ phoneUsed: true }))).toBe("phone_used");
  });

  it("is for active individuals only", () => {
    expect(launchPlaceDecision(facts({ user: null }))).toBe("not_individual");
    expect(launchPlaceDecision(facts({ user: { type: "pro", status: "active" } }))).toBe("not_individual");
    expect(launchPlaceDecision(facts({ user: { type: "individual", status: "active", proId: "abcdefgh" } }))).toBe("not_individual");
    expect(launchPlaceDecision(facts({ user: { type: "individual", status: "suspended" } }))).toBe("not_individual");
  });

  it("waits for a listing that passed moderation, then for a verified number when required", () => {
    expect(launchPlaceDecision(facts({ hasPublished: false }))).toBe("no_listing");
    expect(launchPlaceDecision(facts({ phoneE164: null }))).toBe("phone_unverified");
    expect(launchPlaceDecision(facts({ phoneE164: null, offer: { ...offer, individual: { ...offer.individual, requirePhone: false } } }))).toBe("granted");
  });

  it("dates the credits and the number's marker", () => {
    expect(launchGiftEnd(offer, now).toISOString()).toBe("2027-03-14T09:00:00.000Z");
    expect(launchPlaceMarkerPurgeAt(offer, now).toISOString()).toBe("2027-06-11T00:00:00.000Z");
  });
});

describe("gift credits in the wallet", () => {
  it("land in the plan pool, out of the purchased balance", () => {
    const { wallet, ledger } = grantLaunchGift({ ...EMPTY_WALLET, balance: 12 }, 30);
    expect(wallet).toMatchObject({ balance: 12, planCredits: 30 });
    expect(ledger).toMatchObject({ reason: "launch_gift", delta: 0, paidPart: 0, bonusPart: 0, planCreditsDelta: 30, balanceAfter: 12 });
  });

  it("are spent first and never withdrawn with a pack", () => {
    const gifted = grantLaunchGift({ ...EMPTY_WALLET, balance: 20 }, 30).wallet;
    const spent = spendOption(gifted, 29);
    // -0 from spendOption: no purchased credit taken (buyOption's sales-closed check compares with ===).
    expect(spent.ledger.delta === 0).toBe(true);
    expect(spent.ledger.planCreditsDelta).toBe(-29);
    expect(() => withdrawPurchase(spent.wallet, { paid: 21, bonus: 0 })).toThrow();
  });

  it("are void after their date", () => {
    const doc: WalletDoc = {
      balance: 0,
      frozen: false,
      planCredits: 30,
      planCreditsResetsAt: launchGiftEnd(offer, now),
      allowances: { featured: 0 },
      createdAt: now,
      updatedAt: now,
    };
    expect(walletStateAt(doc, new Date("2027-03-14T08:59:00.000Z")).planCredits).toBe(30);
    expect(walletStateAt(doc, new Date("2027-03-14T09:00:00.000Z")).planCredits).toBe(0);
  });
});

describe("options while sales are closed", () => {
  it("open only with live gift credits", () => {
    expect(optionsOpen(true, EMPTY_WALLET)).toBe(true);
    expect(optionsOpen(false, EMPTY_WALLET)).toBe(false);
    expect(optionsOpen(false, { ...EMPTY_WALLET, balance: 100 })).toBe(false);
    expect(optionsOpen(false, { ...EMPTY_WALLET, planCredits: 30 })).toBe(true);
  });
});
