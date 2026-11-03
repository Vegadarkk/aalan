import { describe, expect, it } from "vitest";
import { accountLookups, namePrefixes, phoneE164 } from "@/lib/decisions/account-query";

// B12 / audit zone 7 P1-1: what a moderator types in the account search, read as lookups.

describe("account search query", () => {
  it("reads an e-mail, lower-cased", () => {
    expect(accountLookups(" Salma.B@Exemple.MA ")).toEqual([{ kind: "email", email: "salma.b@exemple.ma" }]);
    expect(accountLookups("salma@")).toEqual([]);
  });

  it("reads Moroccan numbers in every usual form", () => {
    for (const typed of ["06 12 34 56 78", "0612345678", "+212 6 12 34 56 78", "00212612345678", "06.12.34.56.78"]) {
      expect(accountLookups(typed)).toEqual([{ kind: "phone", e164: "+212612345678" }]);
    }
    expect(phoneE164("0712-345678")).toBe("+212712345678");
    expect(phoneE164("12345")).toBeNull();
    expect(accountLookups("0033 6 12 34 56 78")).toEqual([]);
  });

  it("reads profile, listing and account links", () => {
    expect(accountLookups("https://aalan.ma/fr/profil/abcdefghjk")).toEqual([{ kind: "profile", publicId: "abcdefghjk" }]);
    expect(accountLookups("https://aalan.ma/ar/annonce/iphone-15-casablanca-qz3m2duc?x=1")).toEqual([{ kind: "listing", listingId: "qz3m2duc" }]);
    expect(accountLookups("https://admin.aalan.ma/comptes/AbCdEfGhIjKlMnOpQrStUvWx1234")).toEqual([{ kind: "uid", uid: "AbCdEfGhIjKlMnOpQrStUvWx1234" }]);
    expect(accountLookups("https://aalan.ma/fr/profil/bad")).toEqual([]);
  });

  it("tries an id lookup and the name lookup for an ambiguous word", () => {
    expect(accountLookups("qz3m2duc")).toEqual([
      { kind: "listing", listingId: "qz3m2duc" },
      { kind: "name", prefix: "qz3m2duc" },
    ]);
    expect(accountLookups("abcdefghjk")).toEqual([
      { kind: "profile", publicId: "abcdefghjk" },
      { kind: "name", prefix: "abcdefghjk" },
    ]);
    expect(accountLookups("AbCdEfGhIjKlMnOpQrStUvWx1234").map((lookup) => lookup.kind)).toEqual(["uid", "name"]);
  });

  it("reads a display name, and nothing under two characters", () => {
    expect(accountLookups("Salma B")).toEqual([{ kind: "name", prefix: "Salma B" }]);
    expect(accountLookups("s")).toEqual([]);
    expect(accountLookups("1234")).toEqual([]);
  });

  it("tries the name as typed and capitalized", () => {
    expect(namePrefixes("salma ben-ali")).toEqual(["salma ben-ali", "Salma ben-ali", "Salma Ben-Ali"]);
    expect(namePrefixes("Salma")).toEqual(["Salma"]);
    expect(namePrefixes("سلمى")).toEqual(["سلمى"]);
  });
});
