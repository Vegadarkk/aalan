import { describe, expect, it } from "vitest";
import {
  REQUIRED_IDENTIFIERS,
  euRegistryOk,
  iceFormatOk,
  normalizeIdentifier,
  primaryIdentifier,
  primaryIdentifierOk,
  proLegalSchema,
} from "@/lib/pro/kybc";

// KYBC identifiers per legal form (architecture §8): ICE format, required fields, normalisation.

const ICE = "001234567000089";

describe("ICE", () => {
  it("accepts 15 digits typed with spaces, dots or dashes", () => {
    expect(iceFormatOk(ICE)).toBe(true);
    expect(iceFormatOk("001 234 567 000 089")).toBe(true);
    expect(iceFormatOk("001.234.567-000.089")).toBe(true);
    expect(normalizeIdentifier(" 001 234 567 000 089 ")).toBe(ICE);
  });

  it("rejects other lengths and letters", () => {
    for (const bad of [
      "00123456700008",
      "0012345670000890",
      "00123456700008A",
      "",
    ])
      expect(iceFormatOk(bad)).toBe(false);
  });
});

describe("legal identifiers per form", () => {
  it("lists the required identifiers of §8", () => {
    expect(REQUIRED_IDENTIFIERS).toEqual({
      societe: ["ice", "rc", "if"],
      auto_entrepreneur: ["ice", "aeNumber"],
      commercant: ["ice"],
      cooperative: ["ice", "coopNumber"],
      entreprise_ue: ["country", "registry"],
    });
  });

  it("parses a company and normalises its identifiers", () => {
    const parsed = proLegalSchema.parse({
      form: "societe",
      ice: "001 234 567 000 089",
      rc: "12345 / casa",
      if: "1234567",
    });
    expect(parsed).toEqual({
      form: "societe",
      ice: ICE,
      rc: "12345/CASA",
      if: "1234567",
    });
  });

  it("requires every identifier of a company and of an auto-entrepreneur", () => {
    expect(
      proLegalSchema.safeParse({ form: "societe", ice: ICE, rc: "12345" })
        .success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({ form: "auto_entrepreneur", ice: ICE }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({
        form: "auto_entrepreneur",
        ice: ICE,
        aeNumber: "998877",
      }).success,
    ).toBe(true);
    // A cooperative: ICE and its number at the register of cooperatives (law 112-12).
    expect(
      proLegalSchema.safeParse({ form: "cooperative", ice: ICE }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({
        form: "cooperative",
        ice: ICE,
        coopNumber: "12/2019",
      }).data,
    ).toEqual({ form: "cooperative", ice: ICE, coopNumber: "12/2019" });
  });

  it("requires RC or taxe professionnelle for a sole trader", () => {
    expect(
      proLegalSchema.safeParse({ form: "commercant", ice: ICE }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({ form: "commercant", ice: ICE, tp: "55443322" })
        .success,
    ).toBe(true);
    expect(
      proLegalSchema.safeParse({ form: "commercant", ice: ICE, rc: "777" })
        .success,
    ).toBe(true);
  });

  it("rejects a bad ICE, unknown fields and odd characters", () => {
    expect(
      proLegalSchema.safeParse({
        form: "auto_entrepreneur",
        ice: "123",
        aeNumber: "1",
      }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({
        form: "auto_entrepreneur",
        ice: ICE,
        aeNumber: "1",
        extra: "x",
      }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({
        form: "auto_entrepreneur",
        ice: ICE,
        aeNumber: "<script>",
      }).success,
    ).toBe(false);
  });
});

describe("EU company (carriers space)", () => {
  // Public test numbers: Luhn-valid SIREN/SIRET, a mod-97 Belgian enterprise number.
  it("checks a French SIREN or SIRET by its Luhn key", () => {
    expect(euRegistryOk("FR", "732 829 320")).toBe(true);
    expect(euRegistryOk("FR", "73282932000074")).toBe(true);
    expect(euRegistryOk("FR", "732 829 321")).toBe(false);
    expect(euRegistryOk("FR", "7328293200007")).toBe(false);
    // La Poste's establishments: digits summing to a multiple of 5.
    expect(euRegistryOk("FR", "35600000000056")).toBe(true);
  });

  it("checks a Belgian enterprise number by mod 97, with or without its BE prefix", () => {
    expect(euRegistryOk("BE", "0403.170.701")).toBe(true);
    expect(euRegistryOk("BE", "BE0403170701")).toBe(true);
    expect(euRegistryOk("BE", "0403170702")).toBe(false);
  });

  it("bounds the other registers' formats", () => {
    expect(euRegistryOk("NL", "12345678")).toBe(true);
    expect(euRegistryOk("NL", "1234567")).toBe(false);
    expect(euRegistryOk("ES", "B12345678")).toBe(true);
    expect(euRegistryOk("IT", "12345678901")).toBe(true);
    expect(euRegistryOk("PT", "123456789")).toBe(true);
    expect(euRegistryOk("DE", "HRB 12345")).toBe(true);
    expect(euRegistryOk("DE", "<b>")).toBe(false);
  });

  it("parses an EU company, normalises its number and checks its VAT prefix", () => {
    const parsed = proLegalSchema.parse({
      form: "entreprise_ue",
      country: "BE",
      registry: "BE 0403.170.701",
      vat: "be 0403 170 701",
    });
    expect(parsed).toEqual({
      form: "entreprise_ue",
      country: "BE",
      registry: "0403170701",
      vat: "BE0403170701",
    });
    expect(primaryIdentifier(parsed)).toEqual({
      kind: "eu_registry",
      value: "0403170701",
      country: "BE",
    });
    expect(primaryIdentifierOk(parsed)).toBe(true);
    expect(
      proLegalSchema.safeParse({
        form: "entreprise_ue",
        country: "FR",
        registry: "732829320",
        vat: "BE0403170701",
      }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({
        form: "entreprise_ue",
        country: "FR",
        registry: "123",
      }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({
        form: "entreprise_ue",
        country: "GB",
        registry: "12345678",
      }).success,
    ).toBe(false);
    expect(
      proLegalSchema.safeParse({
        form: "entreprise_ue",
        country: "FR",
        registry: "732829320",
        ice: ICE,
      }).success,
    ).toBe(false);
  });

  it("keeps the ICE as a Moroccan shop's main identifier", () => {
    expect(
      primaryIdentifier({ form: "auto_entrepreneur", ice: ICE, aeNumber: "1" }),
    ).toEqual({ kind: "ice", value: ICE, country: "MA" });
  });
});
