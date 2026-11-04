import { describe, expect, it } from "vitest";
import { visibleText } from "@/app/admin/_components/conversation-viewer";
import { HIDDEN_MARKER, URL_MARKER } from "@/lib/contracts/messaging";

// Moderation markers in the staff conversation viewer read as words (zone 7 audit P3-6).

describe("visibleText", () => {
  it("turns a message hidden by moderation into a hidden flag, never the raw marker", () => {
    expect(visibleText(HIDDEN_MARKER)).toEqual({ text: "", hidden: true });
    expect(visibleText(` ${HIDDEN_MARKER} `).hidden).toBe(true);
  });

  it("names masked parts and links inside a message", () => {
    const shown = visibleText(`Payez sur ${URL_MARKER} ou ${HIDDEN_MARKER}`);
    expect(shown.hidden).toBe(false);
    expect(shown.text).toBe("Payez sur [lien masqué] ou [masqué]");
    expect(shown.text).not.toContain("⟦");
  });

  it("leaves a plain message as written", () => {
    expect(visibleText("Bonjour, toujours disponible ?")).toEqual({ text: "Bonjour, toujours disponible ?", hidden: false });
  });
});
