import { describe, expect, it } from "vitest";
import { parseListingPhotosCli } from "../../scripts/listing-photos";

describe("listing-photos CLI", () => {
  it("reads list and a dry run of set", () => {
    expect(parseListingPhotosCli(["list"])).toEqual({ command: "list" });
    const args = parseListingPhotosCli(["set", "9nmuj9uj=1112598,1957477"]);
    expect(args).toEqual({ command: "set", plan: new Map([["9nmuj9uj", ["1112598", "1957477"]]]), apply: false });
    expect(parseListingPhotosCli(["set", "9nmuj9uj=1112598", "--apply"])).toMatchObject({ apply: true });
  });

  it("refuses a bad listing id, a bad or reused Pexels id, a listing named twice", () => {
    expect(() => parseListingPhotosCli([])).toThrow(/usage/);
    expect(() => parseListingPhotosCli(["set"])).toThrow(/usage/);
    expect(() => parseListingPhotosCli(["list", "--apply"])).toThrow(/usage/);
    expect(() => parseListingPhotosCli(["set", "../etc=1"])).toThrow(/listing id/);
    expect(() => parseListingPhotosCli(["set", "9nmuj9uj=https://example.com/a.jpg"])).toThrow(/Pexels/);
    expect(() => parseListingPhotosCli(["set", "9nmuj9uj="])).toThrow(/Pexels/);
    expect(() => parseListingPhotosCli(["set", `9nmuj9uj=${Array.from({ length: 11 }, (_, i) => i + 1).join(",")}`])).toThrow(/Pexels/);
    expect(() => parseListingPhotosCli(["set", "9nmuj9uj=1", "9nmuj9uj=2"])).toThrow(/twice/);
    expect(() => parseListingPhotosCli(["set", "9nmuj9uj=1", "7k9nwqkw=1"])).toThrow(/one listing/);
  });
});
