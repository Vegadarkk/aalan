import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/preview?pro=<PRO_INVITE_CODE> (owner's card, 24 Nov 2026): the shops' invitation link.
const SECRET = "Z9".repeat(16);
const CODE = "Inv1te".repeat(3);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PREVIEW_SECRET", SECRET);
  vi.stubEnv("PRO_INVITE_CODE", CODE);
});
afterEach(() => vi.unstubAllEnvs());

async function get(query: string): Promise<Response> {
  const { GET } = await import("@/app/api/preview/route");
  return GET(new NextRequest(`https://aalan.ma/api/preview?${query}`));
}

describe("Pro invitation link", () => {
  it("sets the invited shop's pass and opens the sign-up page, then the Pro area", async () => {
    const { proInvitePass } = await import("@/lib/launch/preview");
    const response = await get(`pro=${CODE}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://aalan.ma/fr/inscription?next=%2Ffr%2Fpro");
    expect(response.headers.get("set-cookie")).toContain(`__Host-preview=${proInvitePass(SECRET, CODE)}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await get(`pro=${CODE}&langue=ar`)).headers.get("location")).toBe("https://aalan.ma/ar/inscription?next=%2Far%2Fpro");
    expect((await get(`pro=${CODE}&langue=xx`)).headers.get("location")).toBe("https://aalan.ma/fr/inscription?next=%2Ffr%2Fpro");
  });

  it("answers 404 to a wrong code or when no code is configured", async () => {
    expect((await get("pro=wrongwrongwrong1")).status).toBe(404);
    vi.stubEnv("PRO_INVITE_CODE", "");
    vi.resetModules(); // serverEnv() is read once per process
    expect((await get(`pro=${CODE}`)).status).toBe(404);
  });
});
