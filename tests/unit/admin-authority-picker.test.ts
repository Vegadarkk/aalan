import { describe, expect, it } from "vitest";
import { authorityOf, noticeEntries, noticeLines } from "@/app/admin/_lib/authority-notice";
import { candidateLines, splitPaste } from "@/app/admin/_lib/authority-target-format";
import { authorityTargetLookups, isEmptyLookup } from "@/lib/decisions/authority-target-query";
import type { AuthorityNotice } from "@/lib/decisions/contracts";

// Audit zone 7 P3-4 (content picker of the authority form) and P3-3 (banner of a content under an
// authority request still in force).

const CID = "c0nv3rsat10nIdAbCdEf12";
const UID = "Uq7mT2xY9pLk3vB8nR4sW1";

describe("authority content picker: what a paste designates", () => {
  it("reads stored scope entries and report target keys", () => {
    expect(authorityTargetLookups("listing:qz3m2duc")).toMatchObject({ listings: ["qz3m2duc"], conversations: [], accounts: [], title: null });
    expect(authorityTargetLookups(`conversation:${CID}`)).toMatchObject({ conversations: [CID] });
    expect(authorityTargetLookups(`user:${UID}`).accounts).toEqual([{ kind: "uid", uid: UID }]);
    expect(authorityTargetLookups(`message:${CID}/abcdefghijABCDEFGHIJ`)).toMatchObject({ conversations: [CID], listings: [] });
  });

  it("reads public links: a listing is the content itself, a profile the account", () => {
    expect(authorityTargetLookups("https://aalan.ma/fr/annonce/velo-vtt-casablanca-qz3m2duc?ref=x")).toMatchObject({ listings: ["qz3m2duc"], accounts: [], title: null });
    expect(authorityTargetLookups("https://aalan.ma/ar/profil/abcdefghjk").accounts).toEqual([{ kind: "profile", publicId: "abcdefghjk" }]);
    expect(isEmptyLookup(authorityTargetLookups("https://aalan.ma/fr/annonce/pas-un-id"))).toBe(true);
  });

  it("reads back-office links: report target, conversation, listing review, account", () => {
    expect(authorityTargetLookups("https://admin.aalan.ma/signalements/cible?cle=listing%3Aqz3m2duc")).toMatchObject({ listings: ["qz3m2duc"] });
    expect(authorityTargetLookups(`https://admin.aalan.ma/signalements/cible?cle=message%3A${CID}%2FabcdefghijABCDEFGHIJ`)).toMatchObject({ conversations: [CID] });
    expect(authorityTargetLookups(`https://admin.aalan.ma/conversations/${CID}`)).toMatchObject({ conversations: [CID], accounts: [] });
    expect(authorityTargetLookups("https://admin.aalan.ma/moderation/qz3m2duc")).toMatchObject({ listings: ["qz3m2duc"] });
    expect(authorityTargetLookups(`https://admin.aalan.ma/comptes/${UID}`).accounts).toEqual([{ kind: "uid", uid: UID }]);
    // A review target cannot be held: nothing to look up.
    expect(isEmptyLookup(authorityTargetLookups("https://admin.aalan.ma/signalements/cible?cle=review%3AabcdefghijABCDEFGHIJ12"))).toBe(true);
  });

  it("reads identities without a title search, words as names and a title", () => {
    expect(authorityTargetLookups("salma@exemple.ma")).toMatchObject({ accounts: [{ kind: "email", email: "salma@exemple.ma" }], title: null, listings: [] });
    expect(authorityTargetLookups("06 12 34 56 78")).toMatchObject({ accounts: [{ kind: "phone", e164: "+212612345678" }], title: null });
    const words = authorityTargetLookups("iPhone 13 Pro");
    expect(words.title).toBe("iPhone 13 Pro");
    expect(words.accounts).toEqual([{ kind: "name", prefix: "iPhone 13 Pro" }]);
    expect(authorityTargetLookups("qz3m2duc")).toMatchObject({ listings: ["qz3m2duc"], title: "qz3m2duc" });
  });

  it("finds nothing in a too short or unknown text", () => {
    expect(isEmptyLookup(authorityTargetLookups(" a "))).toBe(true);
    expect(isEmptyLookup(authorityTargetLookups("12345"))).toBe(true);
  });

  it("splits a paste of several links, keeps words as one query", () => {
    expect(splitPaste(`listing:qz3m2duc\nhttps://aalan.ma/fr/profil/abcdefghjk  listing:qz3m2duc`)).toEqual(["listing:qz3m2duc", "https://aalan.ma/fr/profil/abcdefghjk"]);
    expect(splitPaste("  Salma Benali ")).toEqual(["Salma Benali"]);
    expect(splitPaste("   ")).toEqual([]);
  });

  it("previews each content in plain French", () => {
    expect(candidateLines({ kind: "listing", entry: "listing:qz3m2duc", title: "Vélo VTT", status: "published", price: 1200, isDonation: false, ownerName: "Salma B.", city: "Casablanca" })).toEqual({
      kind: "Annonce",
      title: "Vélo VTT",
      detail: "En ligne, 1 200 DH, Casablanca, par Salma B.",
    });
    expect(candidateLines({ kind: "user", entry: `user:${UID}`, displayName: "Karim", status: "suspended", accountType: "pro", publicId: "abcdefghjk", activeListings: 1 }).detail).toBe("Professionnel, suspendu, 1 annonce en ligne");
    expect(candidateLines({ kind: "conversation", entry: `conversation:${CID}`, listingTitle: "Vélo", buyerName: "Ali", sellerName: "Salma", frozen: true, messageCount: 4 })).toEqual({
      kind: "Conversation",
      title: "À propos de « Vélo »",
      detail: "Ali et Salma, 4 messages, déjà gelée",
    });
  });
});

describe("authority notice banner", () => {
  const notice: AuthorityNotice = {
    id: "AbCdEfGhIjKlMnOpQrSt",
    authority: "Parquet de Casablanca",
    kind: "preservation",
    status: "open",
    receivedAt: "2026-11-02T09:30:00.000Z",
    dueAt: "2026-11-09T17:00:00.000Z",
    entries: ["listing:qz3m2duc", `user:${UID}`],
  };

  it("asks about the content and its account", () => {
    expect(noticeEntries({ type: "listing", id: "qz3m2duc" }, UID)).toEqual(["listing:qz3m2duc", `user:${UID}`]);
    expect(noticeEntries({ type: "message", id: `${CID}/abcdefghijABCDEFGHIJ` }, UID)).toEqual([`conversation:${CID}`, `user:${UID}`]);
    expect(noticeEntries({ type: "user", id: UID }, UID)).toEqual([`user:${UID}`]);
    expect(noticeEntries({ type: "review", id: "abcdefghijABCDEFGHIJ12" }, null)).toEqual([]);
  });

  it("names the authority, the preservation and the deadline for an admin", () => {
    const lines = noticeLines(notice, { type: "listing", id: "qz3m2duc" }, true);
    expect(lines.title).toBe("Demande du Parquet de Casablanca, conservation en cours");
    expect(lines.body).toContain("Demande de conservation reçue le");
    expect(lines.body).toContain("visant cette annonce et le compte concerné");
    expect(lines.body).toContain("jusqu'à la clôture de la demande");
    expect(lines.body).toContain("Échéance de réponse :");
  });

  it("tells a moderator the content is preserved without the request's details", () => {
    const lines = noticeLines(notice, { type: "listing", id: "qz3m2duc" }, false);
    expect(lines.title).not.toContain("Parquet");
    expect(lines.body).not.toContain("Parquet");
    expect(lines.body).toContain("réservé aux admins");
  });

  it("drops the deadline once answered", () => {
    expect(noticeLines({ ...notice, status: "answered" }, { type: "listing", id: "qz3m2duc" }, true).body).not.toContain("Échéance");
  });

  it("puts the right French article before the authority", () => {
    expect(authorityOf("Parquet de Casablanca")).toBe("du Parquet de Casablanca");
    expect(authorityOf("Gendarmerie royale")).toBe("de la Gendarmerie royale");
    expect(authorityOf("OCLCTIC")).toBe("de l’OCLCTIC");
    expect(authorityOf("Office anti-terroriste")).toBe("de l’Office anti-terroriste");
    expect(authorityOf("Le procureur du Roi")).toBe("du procureur du Roi");
    expect(authorityOf("DGSN")).toBe("de DGSN");
  });
});
