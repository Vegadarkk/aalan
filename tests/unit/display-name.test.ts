import { describe, expect, it } from "vitest";
import { displayNameSchema, profileSchema } from "@/lib/contracts/auth";
import { displayNameContact } from "@/lib/moderation/display-name";
import { findContacts } from "@/lib/moderation/contacts";
import { analyzeMessage, findLinks } from "@/lib/messaging/risk";
import { redactText } from "@/lib/observability/scrub";
import { descriptionIssue, draftProblems, initialDraft } from "@/components/pro/pro-application-form";

// Audit zone 1 Z1-04 / Z1-27, synthesis B6: no phone number or link in a display name, a shop name
// or a Pro application's presentation (messaging is the only buyer-seller channel).

describe("displayNameContact", () => {
  it("finds phone numbers however they are written", () => {
    for (const name of ["Lina 0661234567", "Lina 06 61 23 45 67", "Lina 06.61.23.45.67", "Lina +212 661 234 567", "لينا ٠٦٦١٢٣٤٥٦٧", "Karim 33 6 12 34 56 78"]) {
      expect(displayNameContact(name), name).toBe("phone");
    }
  });

  it("finds links and bare domains", () => {
    for (const name of ["Lina www.promo-maroc.com", "Lina promo-maroc.com", "Shop avito.ma", "Karim wa.me", "Lina lure-site.top", "Offre promo.click"]) {
      expect(displayNameContact(name), name).toBe("link");
    }
  });

  it("keeps ordinary names, with a few digits", () => {
    for (const name of ["Lina", "لينا بناني", "Garage 2000", "Riad 7", "Jean-Pierre O'Neil", "M. Alami", "Atlas Drive Rent", "J.P. Martin", "Dr. Benali"]) {
      expect(displayNameContact(name), name).toBeNull();
    }
  });
});

describe("displayNameSchema", () => {
  it("refuses a contact detail with the custom code the forms translate", () => {
    const result = displayNameSchema.safeParse("Lina 0661234567");
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.code)).toContain("custom");
    expect(profileSchema.safeParse({ displayName: "Lina www.promo-maroc.com" }).success).toBe(false);
  });

  it("keeps the length limit and accepts a clean name", () => {
    expect(displayNameSchema.safeParse("a".repeat(41)).success).toBe(false);
    expect(displayNameSchema.safeParse("Lina Bennani").success).toBe(true);
  });
});

describe("Pro application texts", () => {
  const draft = { ...initialDraft(null), activity: "car_rental" as const };

  it("refuses a number or a link in the shop name", () => {
    expect(draftProblems({ ...draft, name: "Atlas 0661234567" }, [], false, "token").name).toBe("nameContact");
    expect(draftProblems({ ...draft, name: "Atlas Drive" }, [], false, "token").name).toBeUndefined();
  });

  it("screens the presentation like the storefront's", () => {
    expect(descriptionIssue({ description: "Appelez le 06 61 23 45 67" })).toBe("phone_in_text");
    expect(descriptionIssue({ description: "Voir www.atlas-drive.ma" })).toBe("url_in_text");
    expect(descriptionIssue({ description: "Location de voitures à Marrakech depuis 2010." })).toBeNull();
    expect(descriptionIssue({ description: "  " })).toBeNull();
  });
});

describe("display name cost", () => {
  it("refuses an oversized name on its length alone, without running the contact checks", () => {
    const long = "a".repeat(16_000);
    const started = performance.now();
    const result = displayNameSchema.safeParse(long);
    expect(performance.now() - started).toBeLessThan(50);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.code)).toEqual(["too_big"]);
    expect(displayNameSchema.safeParse("Lina www.wa.me").success).toBe(false);
  });

  it("finds contacts in time linear in a long run without separator", () => {
    const started = performance.now();
    for (let index = 0; index < 5; index += 1) findContacts(`${"a".repeat(32_000)}${index}`);
    expect(performance.now() - started).toBeLessThan(200);
    expect(findContacts(`${"a".repeat(100)}@gmail.com`).map((match) => match.raw)).toEqual([`${"a".repeat(100)}@gmail.com`]);
    expect(findContacts("écrivez à jean.dupont@mail.fr svp").map((match) => match.raw)).toEqual(["jean.dupont@mail.fr"]);
  });

  it("keeps the messaging and log copies of the e-mail pattern linear", () => {
    const run = "a".repeat(32_000);
    const started = performance.now();
    analyzeMessage(run);
    findLinks(run);
    redactText(run);
    expect(performance.now() - started).toBeLessThan(200);
    expect(redactText("to jean.dupont@mail.fr failed")).not.toContain("jean.dupont");
  });
});
