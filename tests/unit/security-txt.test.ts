import { describe, expect, it } from "vitest";
import { securityTxt } from "@/lib/security/security-txt";

// RFC 9116: Contact and Expires are required, Expires less than a year ahead, one field per line.

describe("security.txt", () => {
  it("names the contact, a rolling expiry under a year, the languages and the canonical URL", () => {
    const now = new Date("2026-11-05T13:00:00Z");
    const body = securityTxt({ contact: "abuse@aalan.ma", siteUrl: "https://aalan.ma/", now });
    expect(body.split("\n")).toEqual([
      "Contact: mailto:abuse@aalan.ma?subject=S%C3%A9curit%C3%A9",
      "Expires: 2027-05-04T00:00:00Z",
      "Preferred-Languages: fr, ar, en",
      "Canonical: https://aalan.ma/.well-known/security.txt",
      "",
    ]);
    const expires = new Date(body.match(/^Expires: (.+)$/m)![1]!);
    expect(expires.getTime() - now.getTime()).toBeLessThan(365 * 86_400_000);
  });
});
