import { describe, expect, it } from "vitest";
import { invalidFieldMessage } from "@/app/admin/_components/legal-form";

// The legal settings say what a refused field expects (zone 7 audit P3-10).

describe("invalidFieldMessage", () => {
  it("names the expected format of the numbered and e-mail fields", () => {
    expect(invalidFieldMessage("siren")).toBe("9 chiffres attendus, sans espace.");
    expect(invalidFieldMessage("siret")).toContain("14 chiffres");
    expect(invalidFieldMessage("vatNumber")).toContain("FR suivi de 11 caractères");
    expect(invalidFieldMessage("abuseEmail")).toContain("Adresse e-mail");
  });

  it("falls back to a general message for other fields", () => {
    expect(invalidFieldMessage("hqAddress")).toBe("Valeur invalide.");
  });
});
