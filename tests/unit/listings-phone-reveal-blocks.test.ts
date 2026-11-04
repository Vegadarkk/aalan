import { beforeEach, describe, expect, it, vi } from "vitest";

// Phone reveal and messaging blocks (audit C-5): a block either way hides the number with the same
// 404 as a seller without a verified number, so the requester cannot tell he is blocked; nothing
// is logged or counted. The repositories are mocked (the emulator suite covers the full route).

const NOW = new Date("2026-11-04T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const VIEWER = "viewer-uid-0001";
const OWNER = "owner-uid-0001";
let blocks = new Map<string, string[]>();

vi.mock("@/lib/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => undefined) }));
vi.mock("@/lib/stats/counters", () => ({ countReveal: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit/limiter", () => ({ enforceLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/listings/escalation", () => ({ escalateOnIp: vi.fn(async () => false) }));
vi.mock("@/lib/db/repositories/listing-stats", () => ({ incrementPhoneReveals: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/repositories/reveal-logs", () => ({ hasRevealed: vi.fn(async () => false), recordReveal: vi.fn(async () => undefined), countRevealsSince: vi.fn(async () => 1) }));
vi.mock("@/lib/db/repositories/users", () => ({ getUserPrivate: vi.fn(async () => ({ phoneE164: "+212612345678" })) }));
vi.mock("@/lib/db/repositories/listings", () => ({
  getListing: vi.fn(async (id: string) => ({ id, ownerUid: OWNER, status: "published", moderation: { state: "auto_ok", score: 0, flags: [], openReports: 0 }, contact: { messaging: true, showPhone: true, whatsapp: false } })),
}));
vi.mock("@/lib/db/repositories/profiles", () => ({
  getUserRecord: vi.fn(async (uid: string) => ({ uid, status: "active", createdAt: new Date(NOW.getTime() - 30 * DAY), badges: { emailVerified: true, phoneVerified: true } })),
}));
vi.mock("@/lib/messaging/repository", () => ({
  getUserBlocks: vi.fn(async () => blocks),
  isPairBlocked: (map: Map<string, string[]>, a: string, b: string) => (map.get(a)?.includes(b) ?? false) || (map.get(b)?.includes(a) ?? false),
}));
vi.mock("@/lib/listings/public", () => ({ PUBLIC_STATES: ["published", "paused", "sold", "expired"], SELLER_UNREACHABLE: ["banned", "suspended", "closed"], acceptsContact: () => true }));

const { revealPhone } = await import("@/lib/listings/phone-reveal");
const { recordReveal } = await import("@/lib/db/repositories/reveal-logs");
const { incrementPhoneReveals } = await import("@/lib/db/repositories/listing-stats");
const { getUserBlocks } = await import("@/lib/messaging/repository");

type Auth = Parameters<typeof revealPhone>[0];
type Options = Parameters<typeof revealPhone>[3];
const auth = { user: { uid: VIEWER, emailVerified: true, claims: { role: "individual" } } } as unknown as Auth;
const options = { device: { identity: { ip: "203.0.113.7", deviceKey: "d:abc" } }, now: NOW } as unknown as Options;
const ask = () => revealPhone(auth, new Request("http://localhost:3000/api/listings/abcd2345/phone", { method: "POST" }), "abcd2345", options);

beforeEach(() => {
  blocks = new Map();
  vi.mocked(recordReveal).mockClear();
  vi.mocked(incrementPhoneReveals).mockClear();
});

describe("revealPhone and blocks", () => {
  it("reveals the number when nobody blocked the other, reading both block lists", async () => {
    const outcome = await ask();
    expect(outcome.response.phone.e164).toBe("+212612345678");
    expect(vi.mocked(getUserBlocks)).toHaveBeenLastCalledWith([VIEWER, OWNER]);
    expect(vi.mocked(recordReveal)).toHaveBeenCalledOnce();
  });

  it("answers the no-number 404 when the seller blocked the viewer, or the reverse, and logs nothing", async () => {
    for (const pair of [[OWNER, [VIEWER]], [VIEWER, [OWNER]]] as const) {
      blocks = new Map([[pair[0], [...pair[1]]]]);
      await expect(ask(), pair[0]).rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    expect(vi.mocked(recordReveal)).not.toHaveBeenCalled();
    expect(vi.mocked(incrementPhoneReveals)).not.toHaveBeenCalled();
  });

  it("ignores blocks between other accounts", async () => {
    blocks = new Map([[OWNER, ["someone-else"]]]);
    expect((await ask()).response.phone.e164).toBe("+212612345678");
  });
});
