import { describe, expect, it } from "vitest";
import { shareTargets } from "@/components/listing/share-button";

// Share targets of the « Partager » menu (audit §7): WhatsApp carries the title and the address,
// Facebook the address alone, the e-mail both; everything encoded.

describe("shareTargets", () => {
  it("encodes the title and the address into each target", () => {
    const url = "https://aalan.ma/fr/annonce/velo-vtt-abc12345";
    const targets = shareTargets(url, "Vélo VTT & casque");
    expect(targets.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(`Vélo VTT & casque\n${url}`)}`);
    expect(targets.facebook).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
    expect(targets.email).toBe(`mailto:?subject=${encodeURIComponent("Vélo VTT & casque")}&body=${encodeURIComponent(`Vélo VTT & casque\n${url}`)}`);
    expect(targets.whatsapp).not.toContain("&");
  });

  it("shares the address alone without a title", () => {
    expect(shareTargets("https://aalan.ma/fr", "").whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent("https://aalan.ma/fr")}`);
  });
});
