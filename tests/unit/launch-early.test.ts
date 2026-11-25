import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPostingOpen, fromOpening, postingAllowed } from "@/lib/launch/early";
import { HttpError } from "@/lib/http/errors";
import { previewPass, proInvitePass } from "@/lib/launch/preview";

// Invited shops before the opening (owner's card, 24 Nov 2026): only a validated Pro posts.
const SECRET = "Z9".repeat(16);
const NOW = new Date("2026-11-30T10:00:00Z");
const post = (cookie?: string) => new Request("https://aalan.ma/api/listings", { method: "POST", headers: cookie ? { cookie: `__Host-preview=${cookie}` } : {} });

afterEach(() => vi.unstubAllEnvs());

describe("posting before the opening", () => {
  it("is kept to validated Pros and the team's pass", () => {
    expect(postingAllowed({ closed: false, teamPass: false, role: "individual" })).toBe(true);
    expect(postingAllowed({ closed: true, teamPass: false, role: "pro" })).toBe(true);
    expect(postingAllowed({ closed: true, teamPass: true, role: "individual" })).toBe(true);
    expect(postingAllowed({ closed: true, teamPass: false, role: "individual" })).toBe(false);
    expect(postingAllowed({ closed: true, teamPass: false, role: undefined })).toBe(false);
  });

  it("refuses an individual holding a forwarded invitation, lets a Pro and the team through", () => {
    vi.stubEnv("OPENS_AT", "2026-12-12T10:00:00Z");
    vi.stubEnv("PREVIEW_SECRET", SECRET);
    const refused = (() => {
      try {
        assertPostingOpen(post(proInvitePass(SECRET, "Inv1te".repeat(3))), { role: "individual" }, NOW);
      } catch (error) {
        return error;
      }
    })();
    expect(refused).toBeInstanceOf(HttpError);
    expect(refused).toMatchObject({ status: 403, code: "posting_closed" });
    expect(() => assertPostingOpen(post(), { role: "pro" }, NOW)).not.toThrow();
    expect(() => assertPostingOpen(post(previewPass(SECRET)), { role: "individual" }, NOW)).not.toThrow();
    // Opened: everyone posts again.
    expect(() => assertPostingOpen(post(), { role: "individual" }, new Date("2026-12-12T10:00:00Z"))).not.toThrow();
    vi.stubEnv("OPENS_AT", "");
    expect(() => assertPostingOpen(post(), { role: "individual" }, NOW)).not.toThrow();
  });

  it("dates from the opening while it is ahead", () => {
    const opensAt = new Date("2026-12-12T10:00:00Z");
    expect(fromOpening(NOW, opensAt)).toEqual(opensAt);
    expect(fromOpening(new Date("2026-12-13T00:00:00Z"), opensAt)).toEqual(new Date("2026-12-13T00:00:00Z"));
    expect(fromOpening(NOW, null)).toEqual(NOW);
  });
});
