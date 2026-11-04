import { describe, expect, it } from "vitest";
import { HELP_QUERY_MAX, hashForQuery, queryFromHash } from "@/components/help/help-search-url";

// Audit zone 5 n°19: the /aide search has a shareable address, in the fragment (never sent to the
// server, so the ISR page keeps its edge cache).

describe("help search address", () => {
  it("writes the query in the hash and reads it back, accents and Arabic included", () => {
    for (const query of ["annonce expirée", "تجنب الاحتيال", "50 % & co"]) {
      expect(queryFromHash(hashForQuery(query, ""))).toBe(query);
    }
    expect(hashForQuery("  vélo  ", "")).toBe("#q=v%C3%A9lo");
  });

  it("clears its own hash when the field is emptied, and leaves other hashes alone", () => {
    expect(hashForQuery("", "#q=velo")).toBe("");
    expect(hashForQuery("   ", "#q=velo")).toBe("");
    expect(hashForQuery("", "#assistant")).toBe("#assistant");
    expect(hashForQuery("", "")).toBe("");
  });

  it("ignores other hashes and caps a long shared query", () => {
    expect(queryFromHash("")).toBe("");
    expect(queryFromHash("#assistant")).toBe("");
    expect(queryFromHash("#help-themes")).toBe("");
    expect(queryFromHash(`#q=${"a".repeat(300)}`)).toHaveLength(HELP_QUERY_MAX);
  });
});
