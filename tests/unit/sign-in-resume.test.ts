import { describe, expect, it, vi } from "vitest";
import { clearPendingContact, contactFragment, fragmentDates, pendingContact } from "@/components/rental/rental-day";
import { signupSchema } from "@/lib/contracts/auth";

vi.mock("@/lib/firebase/admin", () => ({ auth: vi.fn() }));
const { actionLinkRequest } = await import("@/lib/auth/links");

// Coming back after signing in or up (audit lot 5: zone 4 L4-03, zone 5 n°8-9, Z1-13): the sign-in
// link carries the contact the visitor had started, the verification link the page a sign-up came from.

describe("contact fragment", () => {
  it("keeps the picked days and names the dialog to reopen", () => {
    const fragment = contactFragment("#du=2026-11-10&au=2026-11-14", "rental");
    expect(fragment).toBe("#du=2026-11-10&au=2026-11-14&contact=rental");
    expect(pendingContact(fragment)).toBe("rental");
    expect(fragmentDates(fragment)).toEqual({ from: "2026-11-10", to: "2026-11-14" });
    expect(contactFragment("", "message")).toBe("#contact=message");
    expect(pendingContact("#du=2026-11-10&au=2026-11-14")).toBeNull();
    expect(pendingContact("")).toBeNull();
  });

  it("drops the contact key from the address bar and keeps the days", () => {
    const location = { pathname: "/fr/annonce/riad-abcd2345", search: "", hash: "#du=2026-11-10&au=2026-11-14&contact=rental" };
    const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
      const at = url.indexOf("#");
      location.hash = at === -1 ? "" : url.slice(at);
    });
    vi.stubGlobal("window", { location, history: { state: null, replaceState } });
    try {
      clearPendingContact();
      expect(replaceState).toHaveBeenLastCalledWith(null, "", "/fr/annonce/riad-abcd2345#du=2026-11-10&au=2026-11-14");
      location.hash = "#contact=message";
      clearPendingContact();
      expect(replaceState).toHaveBeenLastCalledWith(null, "", "/fr/annonce/riad-abcd2345");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("sign-up next", () => {
  const base = { email: "amina@example.com", password: "Une phrase assez longue 42", displayName: "Amina", locale: "fr", consents: { cgu: true, transfers: true, marketing: false }, turnstileToken: "token" };

  it("accepts a same-site path only", () => {
    expect(signupSchema.safeParse({ ...base, next: "/fr/annonce/velo-abcd2345" }).success).toBe(true);
    expect(signupSchema.safeParse(base).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, next: "//evil.example" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, next: "https://evil.example" }).success).toBe(false);
  });

  it("rides in the verification link", () => {
    const request = actionLinkRequest("fr", "verifyEmail", "/fr/annonce/velo-abcd2345#contact=message");
    const url = new URL(request.url);
    expect(url.pathname).toBe("/fr/action");
    expect(url.searchParams.get("mode")).toBe("verifyEmail");
    expect(url.searchParams.get("next")).toBe("/fr/annonce/velo-abcd2345#contact=message");
    expect(new URL(actionLinkRequest("fr", "verifyEmail").url).searchParams.has("next")).toBe(false);
  });
});
