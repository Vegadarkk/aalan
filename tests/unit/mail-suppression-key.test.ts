import { describe, expect, it } from "vitest";
import { suppressionKey } from "@/lib/mail/suppressions";

// A permanent bounce or complaint is a property of the exact mailbox: a +tag variant or a Gmail dot
// variant has its own suppression entry.

describe("suppressionKey", () => {
  it("keys the exact address, case and surrounding spaces aside", () => {
    expect(suppressionKey(" Salma@Example.ma ")).toBe(suppressionKey("salma@example.ma"));
    expect(suppressionKey("salma+promo@example.ma")).not.toBe(suppressionKey("salma@example.ma"));
    expect(suppressionKey("s.alma@gmail.com")).not.toBe(suppressionKey("salma@gmail.com"));
  });
});
