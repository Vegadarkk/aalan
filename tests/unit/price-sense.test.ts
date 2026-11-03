import { describe, expect, it } from "vitest";
import { arabicAmountWords, arabicNumberWords, frenchAmountWords, frenchNumberWords, priceCeiling, priceLooksHigh } from "@/lib/listings/price-sense";

describe("priceLooksHigh", () => {
  it("flags a car rental at 335 050 DH a day (zone 3 P1-3, B9), not at 350", () => {
    expect(priceLooksHigh(335_050, "vehicules", "location-voitures")).toBe(true);
    expect(priceLooksHigh(350, "vehicules", "location-voitures")).toBe(false);
  });

  it("uses the subcategory first, then the category, else nothing", () => {
    expect(priceCeiling("electronique", "telephones-objets-connectes")).toBe(50_000);
    expect(priceCeiling("maison-jardin", "ameublement")).toBe(300_000);
    expect(priceCeiling("immobilier", "vente")).toBeNull();
    expect(priceLooksHigh(null, "vehicules", "location-voitures")).toBe(false);
  });
});

describe("frenchNumberWords", () => {
  it.each([
    [0, "zéro"],
    [1, "un"],
    [17, "dix-sept"],
    [21, "vingt et un"],
    [71, "soixante et onze"],
    [72, "soixante-douze"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [91, "quatre-vingt-onze"],
    [100, "cent"],
    [200, "deux cents"],
    [201, "deux cent un"],
    [1000, "mille"],
    [80_000, "quatre-vingt mille"],
    [200_000, "deux cent mille"],
    [335_050, "trois cent trente-cinq mille cinquante"],
    [1_000_000, "un million"],
    [200_000_000, "deux cents millions"],
    [2_500_000, "deux millions cinq cent mille"],
  ])("%i -> %s", (value, words) => {
    expect(frenchNumberWords(value)).toBe(words);
  });

  it("names the dirhams", () => {
    expect(frenchAmountWords(1)).toBe("un dirham");
    expect(frenchAmountWords(335_050)).toBe("trois cent trente-cinq mille cinquante dirhams");
    expect(frenchAmountWords(2_000_000)).toBe("deux millions de dirhams");
  });
});

describe("arabicNumberWords", () => {
  it.each([
    [3, "ثلاثة"],
    [11, "أحد عشر"],
    [35, "خمسة وثلاثون"],
    [1000, "ألف"],
    [2000, "ألفان"],
    [3000, "ثلاثة آلاف"],
    [15_000, "خمسة عشر ألفًا"],
    [100_000, "مائة ألف"],
    [335_050, "ثلاثمائة وخمسة وثلاثون ألفًا وخمسون"],
    [1_500_000, "مليون وخمسمائة ألف"],
  ])("%i -> %s", (value, words) => {
    expect(arabicNumberWords(value)).toBe(words);
  });

  it("agrees the dirham with the last two digits", () => {
    expect(arabicAmountWords(335_050)).toBe("ثلاثمائة وخمسة وثلاثون ألفًا وخمسون درهمًا");
    expect(arabicAmountWords(1500)).toBe("ألف وخمسمائة درهم");
    expect(arabicAmountWords(5)).toBe("خمسة دراهم");
    expect(arabicAmountWords(2)).toBe("درهمان");
  });
});
