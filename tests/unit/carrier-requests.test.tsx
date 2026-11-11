import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { CarrierRequestCard, CarrierRequestEventItem } from "@/components/carriers/carrier-request-card";
import { previewText } from "@/components/messages/inbox";
import { settledPins } from "@/components/messages/thread-state";
import { moroccoTime } from "@/lib/appointments/time";
import { nextCarrierStep, storedBasket } from "@/lib/carrier-requests/service";
import { carrierBasketSchema, carrierRequestEventOf, carrierRequestMarker, carrierRequestOpen, type CarrierRequestView } from "@/lib/contracts/carrier-requests";
import type { ConversationView } from "@/lib/contracts/messaging";
import { startConversationOfferSchema } from "@/lib/contracts/offers";
import type { CarrierRequestDoc } from "@/lib/db/schemas";
import { type HttpError } from "@/lib/http/errors";
import { dayNumber, dayString } from "@/lib/listings/rental-availability";

// Place requests on a carrier's departure (transporteurs/spec.md §5): the basket rules, the step
// machine of the server, the card, the thread steps and the inbox preview in FR and AR.

const NOW = moroccoTime("2026-11-10", 10 * 60);
const TODAY = dayNumber("2026-11-10");
const day = (offset: number) => dayString(TODAY + offset);

function render(node: React.ReactNode, locale: "fr" | "ar" = "fr"): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "fr" ? fr : ar} timeZone="Africa/Casablanca">
      {node}
    </NextIntlClientProvider>,
  ).replaceAll("&#x27;", "'");
}

const BASKET = { kg: 20, items: { "e-scooter": 1 }, pickup: true as const };

function requestDoc(overrides: Partial<CarrierRequestDoc> = {}): CarrierRequestDoc {
  return { id: "AbCdEfGhIjKl", status: "requested", departOn: day(5), basket: BASKET, estimate: { total: 11000, currency: "EUR", onRequest: [] }, createdAt: new Date(NOW), updatedAt: new Date(NOW), ...overrides };
}

function view(overrides: Partial<CarrierRequestView> = {}): CarrierRequestView {
  return { id: "AbCdEfGhIjKl", status: "requested", requestedByMe: false, departOn: day(5), basket: BASKET, estimate: { total: 11000, currency: "EUR", onRequest: [] }, updatedAt: NOW, ...overrides };
}

const thrown = (run: () => unknown): HttpError => {
  try {
    run();
  } catch (error) {
    return error as HttpError;
  }
  throw new Error("no error");
};

describe("place request rules", () => {
  it("takes a basket with some weight or one item, never two requests at once", () => {
    expect(carrierBasketSchema.safeParse({ kg: 0, items: {} }).success).toBe(false);
    expect(carrierBasketSchema.safeParse({ kg: 0, items: { suitcase: 2 } }).success).toBe(true);
    expect(carrierBasketSchema.safeParse({ kg: 5, items: { rocket: 1 } }).success).toBe(false);
    expect(carrierBasketSchema.safeParse({ kg: 5, items: {}, pickup: false }).success).toBe(false);
    expect(storedBasket({ kg: 3, items: { "tv-large": 1, suitcase: 2 } })).toEqual({ kg: 3, items: { suitcase: 2, "tv-large": 1 } });
    const start = { listingId: "abcdefgh", text: "Bonjour", turnstileToken: "ok" };
    expect(startConversationOfferSchema.safeParse({ ...start, carrierRequest: { basket: BASKET } }).success).toBe(true);
    expect(startConversationOfferSchema.safeParse({ ...start, carrierRequest: { basket: BASKET }, rentalRequest: { from: day(1), to: day(2) } }).success).toBe(false);
  });

  it("reads its markers and stays pinned until the departure day", () => {
    expect(carrierRequestEventOf(carrierRequestMarker("accepted"))).toBe("accepted");
    expect(carrierRequestEventOf("⟦location:accepted⟧")).toBeNull();
    expect(carrierRequestOpen({ status: "accepted", departOn: day(0) }, TODAY)).toBe(true);
    expect(carrierRequestOpen({ status: "accepted", departOn: day(-1) }, TODAY)).toBe(false);
    expect(carrierRequestOpen({ status: "declined", departOn: day(3) }, TODAY)).toBe(false);
  });

  it("moves the request between the client and the carrier", () => {
    const now = new Date(NOW);
    const asked = nextCarrierStep(undefined, { action: "request", basket: BASKET }, "buyer", now, { departOn: day(5), estimate: { total: 11000, currency: "EUR", onRequest: [] } });
    expect(asked).toMatchObject({ event: "requested", request: { status: "requested", departOn: day(5), basket: BASKET, estimate: { total: 11000 } } });
    expect(nextCarrierStep(asked.request, { action: "request", basket: { kg: 3, items: {} } }, "buyer", now, { departOn: day(5) }).event).toBe("changed");
    expect(thrown(() => nextCarrierStep(undefined, { action: "request", basket: BASKET }, "seller", now, { departOn: day(5) })).status).toBe(403);
    const id = asked.request.id;
    expect(thrown(() => nextCarrierStep(asked.request, { action: "accept", id }, "buyer", now)).code).toBe("carrier_request_changed");
    expect(nextCarrierStep(asked.request, { action: "accept", id }, "seller", now).request.status).toBe("accepted");
    expect(nextCarrierStep(asked.request, { action: "decline", id }, "seller", now).event).toBe("declined");
    expect(nextCarrierStep(asked.request, { action: "withdraw", id }, "buyer", now).event).toBe("withdrawn");
    expect(thrown(() => nextCarrierStep(requestDoc({ departOn: day(-1) }), { action: "accept", id: "AbCdEfGhIjKl" }, "seller", now)).code).toBe("carrier_request_past");
    expect(thrown(() => nextCarrierStep(requestDoc({ status: "declined" }), { action: "withdraw", id: "AbCdEfGhIjKl" }, "buyer", now)).code).toBe("carrier_request_changed");
  });
});

describe("place request in the thread", () => {
  const props = { cid: "c000000000000000000001", counterpartName: "Samira", writable: true, now: NOW, onChange: () => {} };

  it("shows the carrier the basket, the estimate, the answers and the indicative-price notice", () => {
    const html = render(<CarrierRequestCard {...props} request={view()} />);
    expect(html).toContain('data-status="requested-theirs"');
    expect(html).toContain("demande une place");
    expect(html).toContain("20 kg de colis, 1 × Trottinette électrique, collecte à domicile");
    expect(html).toContain("Prix estimé : 110,00");
    expect(html).toContain("Place réservée");
    expect(html).toContain("Pas de place");
    expect(html).toContain("le prix final après la pesée de contrôle");
    const accepted = render(<CarrierRequestCard {...props} request={view({ status: "accepted" })} />);
    expect(accepted).toContain("Mettre à jour la place restante");
    expect(accepted).toContain('href="/fr/pro/departs"');
  });

  it("shows the client the request sent, its estimate on request items, and hides it once the departure is gone", () => {
    const html = render(<CarrierRequestCard {...props} request={view({ requestedByMe: true, estimate: { total: 4000, currency: "EUR", onRequest: ["e-scooter"] } })} />);
    expect(html).toContain('data-status="requested-mine"');
    expect(html).toContain("Sur devis : Trottinette électrique");
    expect(html).toContain("Retirer la demande");
    expect(render(<CarrierRequestCard {...props} request={view({ requestedByMe: true, estimate: null })} />)).toContain("Pas de prix estimé");
    expect(render(<CarrierRequestCard {...props} request={view({ departOn: day(-1) })} />)).toBe("");
    expect(render(<CarrierRequestCard {...props} request={view()} />, "ar")).toContain("يطلب مكانًا");
  });

  it("renders the steps and the inbox preview, and keeps the settled pins beside an open request", () => {
    const step = { event: "requested" as const, byMe: false, departOn: day(5), basket: BASKET, estimate: null };
    expect(render(<CarrierRequestEventItem step={step} counterpartName="Samira" time="10:02" />)).toContain("demande une place pour le départ du");
    expect(render(<CarrierRequestEventItem step={{ ...step, event: "declined", byMe: false, basket: null }} counterpartName="Rif Express" time="10:02" />)).toContain("n'a pas de place pour ce départ");
    const row = { lastMessage: { preview: carrierRequestMarker("accepted"), mine: false, at: NOW, flagged: false } } as Pick<ConversationView, "lastMessage">;
    expect(previewText(row, { hidden: "masqué", maskedLink: "lien", carrierRequest: (event) => `place:${event}` })).toBe("place:accepted");
    const conversation = {
      offer: null,
      appointment: { id: "a", kind: "pickup", status: "confirmed", slots: [], chosen: { start: Math.ceil((NOW + 86_400_000) / 900_000) * 900_000, minutes: 60 }, proposedByMe: true, updatedAt: NOW },
      rentalRequest: null,
      rentalHistory: [],
      carrierRequest: view({ status: "accepted" }),
    } as unknown as Pick<ConversationView, "offer" | "appointment" | "rentalRequest" | "rentalHistory" | "carrierRequest">;
    expect(settledPins(conversation, NOW)?.alongside).toBe(true);
  });
});
