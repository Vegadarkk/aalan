import { describe, expect, it } from "vitest";
import { passBlock } from "@/components/payments/pass-offer";
import type { PassOffer, SubscriptionResponse } from "@/lib/contracts/payments";

// Why the Pass Boutique cannot be bought (zone 6 audit 6-09): « sales not open yet » and « payment
// not available » are two reasons, never one « pas disponible pour le moment ».

const offer: PassOffer = { id: "pass_30", plan: "essentiel", days: 30, priceMinor: 29_900, credits: 30, activeListings: 50, available: true, withinLimit: true, otherPlan: false } as PassOffer;

function data(overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
  return {
    salesOpen: true,
    available: true,
    lifecycle: "verified",
    plan: "none",
    planSource: "none",
    passEndsAt: null,
    graceUntil: null,
    launchOfferEndsAt: null,
    launchOfferNoticeDays: 30,
    launchOfferOpen: false,
    subscription: null,
    plans: [],
    passes: [offer],
    consentVersion: "1",
    passConsentVersion: "1",
    ...overrides,
  };
}

describe("passBlock", () => {
  it("says the sales are closed, apart from a payment that is not configured", () => {
    expect(passBlock(data({ salesOpen: false }), offer, false)).toBe("salesClosed");
    expect(passBlock(data({ available: false }), offer, false)).toBe("unavailable");
    expect(passBlock(data(), { ...offer, available: false }, false)).toBe("unavailable");
  });

  it("keeps the launch offer and a running subscription first, and lets a buyable pass through", () => {
    expect(passBlock(data({ salesOpen: false, launchOfferOpen: true }), offer, false)).toBe("launchOffer");
    expect(passBlock(data(), offer, true)).toBe("subscribed");
    expect(passBlock(data(), offer, false)).toBeNull();
  });
});
