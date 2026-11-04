import { describe, expect, it } from "vitest";
import { currentSection, NAV_GROUPS } from "@/app/admin/_components/admin-nav";
import { formatBytes, formatQuotaAmount, formatQuotaPeriod, formatQuotaShare, QUOTA_LEVEL } from "@/app/admin/_lib/quota-format";
import { activityKind, activityShown } from "@/lib/decisions/activity";

// Back-office home and menu (zone 7 audit P2-6, P2-7): the quota board's wording, the team's
// activity feed filter, and the grouped sections with the current one marked.

describe("quota wording", () => {
  it("rounds amounts in French instead of raw decimals", () => {
    expect(formatBytes(201_326_592)).toBe("201 Mo");
    expect(formatBytes(12_345_678)).toBe("12,35 Mo");
    expect(formatBytes(1_234_567_890)).toBe("1,23 Go");
    expect(formatQuotaAmount("bytes", 201_326_592, 10_000_000_000)).toBe("201 Mo sur 10 Go");
    expect(formatQuotaAmount("usd_micros", 120_000, 5_000_000)).toBe("0,12 USD sur 5 USD");
    expect(formatQuotaAmount("operations", 1234, 50_000).replace(/\s/g, " ")).toBe("1 234 sur 50 000");
  });

  it("gives the share used and a readable state", () => {
    expect(formatQuotaShare(0)).toBe("");
    expect(formatQuotaShare(0.004)).toBe("moins de 1 %");
    expect(formatQuotaShare(0.7).replace(/\s/g, " ")).toBe("70 %");
    expect(QUOTA_LEVEL.unknown.label).toBe("Pas encore mesuré");
  });

  it("names the period", () => {
    expect(formatQuotaPeriod("2026-11-04", "day")).toBe("Jour en cours");
    expect(formatQuotaPeriod("2026-11", "month")).toBe("Novembre 2026");
  });
});

describe("team activity feed", () => {
  it("lists moderation work in French and leaves reads and settings out", () => {
    expect(activityKind("decision.remove")?.label).toBe("Retrait");
    expect(activityKind("listing.reject")?.label).toBe("Annonce retenue refusée");
    expect(activityKind("pro.verify")?.label).toBe("Compte Pro validé");
    expect(activityKind("pro.sector.correct")?.label).toBe("Activité d'une boutique corrigée");
    expect(activityShown("pro.note", false)).toBe(true);
    expect(activityKind("pro.kybc.view")).toBeNull();
    expect(activityKind("conversation.read")).toBeNull();
    expect(activityKind("legal.updated")).toBeNull();
    expect(activityKind("decision.unknown")).toBeNull();
  });

  it("keeps authority requests out of a moderator's feed", () => {
    expect(activityShown("authority.create", true)).toBe(true);
    expect(activityShown("authority.create", false)).toBe(false);
    expect(activityShown("decision.warn", false)).toBe(true);
  });
});

describe("back-office menu", () => {
  it("groups the sections in four, the settings for admins only", () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(["Modération", "Comptes", "Pilotage", "Réglages"]);
    const forModerators = NAV_GROUPS.flatMap((group) => group.items.filter((item) => !item.adminOnly).map((item) => item.href));
    expect(forModerators).toEqual(["/signalements", "/moderation", "/recours", "/comptes", "/pros", "/statistiques", "/guide"]);
    expect(NAV_GROUPS.find((group) => group.label === "Réglages")?.items.every((item) => item.adminOnly)).toBe(true);
  });

  it("marks the section of the current page, its sub-pages included", () => {
    expect(currentSection("/", true)).toBe("/");
    expect(currentSection("/moderation/abcd2345", false)).toBe("/moderation");
    expect(currentSection("/decisions/xyz", false)).toBe("/signalements");
    expect(currentSection("/parametres/quotas", true)).toBe("/parametres/quotas");
    expect(currentSection("/parametres/quotas", false)).toBeNull();
    expect(currentSection("/prosx", true)).toBeNull();
  });
});
