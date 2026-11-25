import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import type { CampaignState, SubscriberEntry } from "@/lib/newsletter/repository";

// The opening list's three e-mails (owner, 2026-11-16): the schedule from OPENS_AT, and the job
// that sends the due one within its Resend budget, resumes from its cursor, reports a window that
// closed with subscribers left, and deletes the list 30 days after the opening. Repositories,
// quotas, the alert and the mail delivery are mocked.

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("@/lib/firebase/admin", () => ({ isFirestoreConfigured: () => true, isFirebaseConfigured: () => true, db: vi.fn() }));
vi.mock("@/lib/mail/deliver", () => ({ deliverMail: vi.fn() }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));
const degraded = { value: false };
const room = { value: null as number | null };
vi.mock("@/lib/quota", () => ({ isDegraded: vi.fn(async () => degraded.value), headroom: vi.fn(async () => room.value), consume: vi.fn() }));
vi.mock("@/lib/newsletter/token", () => ({ unsubscribeToken: (email: string) => `tok-${email}` }));
vi.mock("@/lib/newsletter/repository", () => ({ listSubscribersAfter: vi.fn(), readCampaignState: vi.fn(), writeCampaignState: vi.fn(async () => undefined), deleteSubscribers: vi.fn() }));

const { campaignWindows, dueCampaign, closedCampaigns, purgeDue } = await import("@/lib/newsletter/campaigns");
const repo = await import("@/lib/newsletter/repository");
const { deliverMail } = await import("@/lib/mail/deliver");
const { alert } = await import("@/lib/alert");
const { resetServerEnv } = await import("@/lib/env");
const { NEWSLETTER_FALLBACK_BUDGET, sendNewsletterCampaigns } = await import("@/worker/jobs/newsletter-campaigns");

const OPENS = new Date("2026-12-12T10:00:00Z");
const at = (iso: string) => new Date(iso);

let subscribers: SubscriberEntry[];
let state: CampaignState;

function sub(id: string, minute: number, lang: "fr" | "ar" | "rif" = "fr"): SubscriberEntry {
  return { id, email: `${id}@example.com`, lang, confirmedAt: Timestamp.fromDate(new Date(Date.UTC(2026, 10, 20, 10, minute))) };
}

beforeEach(() => {
  process.env.OPENS_AT = "2026-12-12T10:00:00+00:00";
  resetServerEnv();
  degraded.value = false;
  room.value = null;
  subscribers = [];
  state = { opensAt: null, campaigns: {}, purgedAt: null };
  vi.mocked(deliverMail).mockReset().mockResolvedValue({ provider: "memory", id: "m" });
  vi.mocked(alert).mockClear();
  vi.mocked(repo.readCampaignState).mockReset().mockImplementation(async () => structuredClone(state));
  vi.mocked(repo.writeCampaignState).mockReset().mockImplementation(async (next) => {
    state = structuredClone(next);
  });
  vi.mocked(repo.deleteSubscribers).mockReset();
  vi.mocked(repo.listSubscribersAfter)
    .mockReset()
    .mockImplementation(async (cursor, limit) => {
      const start = cursor.afterId ? subscribers.findIndex((entry) => entry.id === cursor.afterId) + 1 : 0;
      const slice = subscribers.slice(start, start + limit);
      const last = slice.at(-1);
      return { subscribers: slice, read: slice.length, last: last ? { at: last.confirmedAt.toDate(), id: last.id } : null };
    });
});

describe("campaign schedule", () => {
  it("times J-7, J-1 and the opening from OPENS_AT, each until the next one", () => {
    expect(campaignWindows(OPENS).map((window) => [window.campaign, window.from.toISOString(), window.until.toISOString()])).toEqual([
      ["teaser", "2026-12-05T10:00:00.000Z", "2026-12-11T10:00:00.000Z"],
      ["places", "2026-12-11T10:00:00.000Z", "2026-12-12T10:00:00.000Z"],
      ["opening", "2026-12-12T10:00:00.000Z", "2026-12-15T10:00:00.000Z"],
    ]);
    expect(dueCampaign(OPENS, at("2026-12-05T09:59:59Z"))).toBeNull();
    expect(dueCampaign(OPENS, at("2026-12-05T10:00:00Z"))?.campaign).toBe("teaser");
    expect(dueCampaign(OPENS, at("2026-12-11T10:00:00Z"))?.campaign).toBe("places");
    expect(dueCampaign(OPENS, at("2026-12-12T10:02:00Z"))?.campaign).toBe("opening");
    expect(dueCampaign(OPENS, at("2026-12-15T10:00:00Z"))).toBeNull();
    expect(dueCampaign(null, at("2026-12-12T10:02:00Z"))).toBeNull();
    expect(closedCampaigns(OPENS, at("2026-12-12T10:02:00Z")).map((window) => window.campaign)).toEqual(["teaser", "places"]);
    expect(purgeDue(OPENS, at("2027-01-11T09:59:59Z"))).toBe(false);
    expect(purgeDue(OPENS, at("2027-01-11T10:00:00Z"))).toBe(true);
  });
});

describe("newsletter-campaigns job", () => {
  it("does nothing before the teaser", async () => {
    subscribers = [sub("a", 1)];
    const result = await sendNewsletterCampaigns(at("2026-12-01T10:00:00Z"));
    expect(result).toMatchObject({ campaign: null, mails: 0 });
    expect(deliverMail).not.toHaveBeenCalled();
  });

  it("sends the due e-mail once per subscriber, in their language, with the places and an idempotency key", async () => {
    subscribers = [sub("a", 1), sub("b", 2, "ar"), sub("c", 3, "rif")];
    const result = await sendNewsletterCampaigns(at("2026-12-11T10:02:00Z"));
    expect(result).toMatchObject({ campaign: "places", mails: 3, complete: true });
    expect(vi.mocked(deliverMail).mock.calls.map(([mail]) => [mail.locale, mail.to, mail.idempotencyKey])).toEqual([
      ["fr", "a@example.com", "newsletter-places-a"],
      ["ar", "b@example.com", "newsletter-places-b"],
      ["rif", "c@example.com", "newsletter-places-c"],
    ]);
    expect(vi.mocked(deliverMail).mock.calls[0]![0]).toMatchObject({
      template: "newsletterCampaign",
      priority: "bulk",
      data: { campaign: "places", opensAt: "2026-12-12T10:00:00.000Z", unsubscribeToken: "tok-a@example.com", places: { seats: 1000, proSeats: 100, credits: 30, creditDays: 90, months: 6, requirePhone: true } },
    });
    // The next run finds nobody new; a late subscriber is served by a later run.
    vi.mocked(deliverMail).mockClear();
    expect(await sendNewsletterCampaigns(at("2026-12-11T10:12:00Z"))).toMatchObject({ mails: 0, complete: true });
    subscribers.push(sub("d", 4));
    expect(await sendNewsletterCampaigns(at("2026-12-11T10:22:00Z"))).toMatchObject({ mails: 1, complete: true });
    expect(vi.mocked(deliverMail).mock.calls[0]![0].to).toBe("d@example.com");
    expect(state.campaigns.places).toMatchObject({ afterId: "d", sent: 4 });
    expect(state.opensAt?.toISOString()).toBe("2026-12-12T10:00:00.000Z");
  });

  it("stays under the Resend budget and resumes where it stopped", async () => {
    subscribers = ["a", "b", "c", "d", "e"].map((id, index) => sub(id, index));
    room.value = 2;
    expect(await sendNewsletterCampaigns(at("2026-12-05T10:02:00Z"))).toMatchObject({ campaign: "teaser", mails: 2, stopped: "cap", complete: false });
    room.value = 0;
    expect(await sendNewsletterCampaigns(at("2026-12-05T10:12:00Z"))).toMatchObject({ mails: 0, stopped: "cap" });
    room.value = 50;
    expect(await sendNewsletterCampaigns(at("2026-12-06T10:02:00Z"))).toMatchObject({ mails: 3, complete: true });
    expect(vi.mocked(deliverMail).mock.calls.map(([mail]) => mail.to)).toEqual(["a", "b", "c", "d", "e"].map((id) => `${id}@example.com`));
    room.value = null;
    subscribers = Array.from({ length: 30 }, (_, index) => sub(`x${index}`, index));
    state = { opensAt: null, campaigns: {}, purgedAt: null };
    expect(await sendNewsletterCampaigns(at("2026-12-07T10:02:00Z"))).toMatchObject({ mails: NEWSLETTER_FALLBACK_BUDGET, stopped: "cap" });
  });

  it("sends nothing while a Resend quota is degraded, and stops when the delivery skips for quota", async () => {
    subscribers = [sub("a", 1), sub("b", 2)];
    degraded.value = true;
    expect(await sendNewsletterCampaigns(at("2026-12-05T10:02:00Z"))).toMatchObject({ mails: 0, stopped: "quota" });
    degraded.value = false;
    vi.mocked(deliverMail).mockResolvedValueOnce({ skipped: "quota" });
    expect(await sendNewsletterCampaigns(at("2026-12-05T10:12:00Z"))).toMatchObject({ mails: 0, stopped: "quota" });
    expect(state.campaigns.teaser?.afterId).toBeNull();
  });

  it("passes over a suppressed address and stops on a provider failure without moving past it", async () => {
    subscribers = [sub("a", 1), sub("b", 2), sub("c", 3)];
    vi.mocked(deliverMail)
      .mockResolvedValueOnce({ skipped: "suppressed" })
      .mockRejectedValueOnce(new Error("provider down"));
    expect(await sendNewsletterCampaigns(at("2026-12-05T10:02:00Z"))).toMatchObject({ mails: 0, skipped: 1, stopped: "mail" });
    expect(state.campaigns.teaser?.afterId).toBe("a");
  });

  it("reports once a window that closed with subscribers left, and never sends it late", async () => {
    subscribers = [sub("a", 1), sub("b", 2)];
    room.value = 1;
    await sendNewsletterCampaigns(at("2026-12-05T10:02:00Z"));
    room.value = 50;
    const result = await sendNewsletterCampaigns(at("2026-12-11T10:02:00Z"));
    expect(result).toMatchObject({ campaign: "places", mails: 2 });
    expect(vi.mocked(deliverMail).mock.calls.filter(([mail]) => (mail.data as { campaign: string }).campaign === "teaser")).toHaveLength(1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(state.campaigns.teaser?.closed).toBe(true);
    await sendNewsletterCampaigns(at("2026-12-11T10:12:00Z"));
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("skips the J-1 e-mail without launch places and sends the opening one without them", async () => {
    const { getPricing } = await import("@/lib/config/runtime");
    const pricing = await getPricing();
    const spy = vi.spyOn(await import("@/lib/config/runtime"), "getPricing").mockResolvedValue({ ...pricing, launchOffer: { ...pricing.launchOffer, active: false } });
    subscribers = [sub("a", 1)];
    expect(await sendNewsletterCampaigns(at("2026-12-11T10:02:00Z"))).toMatchObject({ campaign: "places", mails: 0, stopped: "no-places" });
    expect(await sendNewsletterCampaigns(at("2026-12-12T10:02:00Z"))).toMatchObject({ campaign: "opening", mails: 1 });
    expect(vi.mocked(deliverMail).mock.calls[0]![0].data).toMatchObject({ campaign: "opening", places: null });
    spy.mockRestore();
  });

  it("deletes the list 30 days after the opening, once, even when OPENS_AT is gone", async () => {
    state = { opensAt: OPENS, campaigns: {}, purgedAt: null };
    delete process.env.OPENS_AT;
    resetServerEnv();
    vi.mocked(repo.deleteSubscribers).mockResolvedValueOnce(400).mockResolvedValueOnce(12);
    expect(await sendNewsletterCampaigns(at("2027-01-11T10:02:00Z"))).toMatchObject({ purged: 412, complete: true });
    expect(state.purgedAt?.toISOString()).toBe("2027-01-11T10:02:00.000Z");
    expect(await sendNewsletterCampaigns(at("2027-01-11T10:12:00Z"))).toMatchObject({ complete: true });
    expect(repo.deleteSubscribers).toHaveBeenCalledTimes(2);
    expect(deliverMail).not.toHaveBeenCalled();
  });
});
