import { beforeEach, describe, expect, it, vi } from "vitest";

// ISR invalidation of the public listing and profile pages, for every locale, safe outside a
// Next request context (worker, tests).

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn<(path: string) => void>() }));
const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: cache.revalidatePath }));
vi.mock("@/lib/logging/logger", () => ({ logger: log }));

const { flushPagePurgeForTests, listingPagePaths, listingRevalidationPaths, profilePagePaths, revalidateListingPaths, setRevalidationSinksForTests, storefrontPagePaths } = await import("@/lib/listings/revalidate");
const { resetServerEnv } = await import("@/lib/env");

beforeEach(() => {
  cache.revalidatePath.mockReset();
  log.debug.mockReset();
  log.warn.mockReset();
  setRevalidationSinksForTests(undefined);
});

describe("revalidateListingPaths", () => {
  it("names every locale of the listing and profile pages", () => {
    expect(listingPagePaths("velo-casablanca-abcd2345")).toEqual(["/fr/annonce/velo-casablanca-abcd2345", "/ar/annonce/velo-casablanca-abcd2345", "/rif/annonce/velo-casablanca-abcd2345"]);
    expect(profilePagePaths("k7m2p9q4r8")).toEqual(["/fr/profil/k7m2p9q4r8", "/ar/profil/k7m2p9q4r8", "/rif/profil/k7m2p9q4r8"]);
    expect(listingRevalidationPaths({ publicId: "k7m2p9q4r8" })).toHaveLength(3);
    expect(storefrontPagePaths("atlas-auto-k7m2p9q4")).toEqual(["/fr/boutique/atlas-auto-k7m2p9q4", "/ar/boutique/atlas-auto-k7m2p9q4", "/rif/boutique/atlas-auto-k7m2p9q4"]);
    expect(listingRevalidationPaths({ publicId: "k7m2p9q4r8", shopSegment: "atlas-auto-k7m2p9q4" })).toHaveLength(6);
    expect(listingRevalidationPaths({})).toEqual([]);
  });

  it("revalidates each path once", () => {
    const paths = revalidateListingPaths({ slugId: "velo-casablanca-abcd2345", publicId: "k7m2p9q4r8" });
    expect(paths).toHaveLength(6);
    expect(cache.revalidatePath.mock.calls.map(([path]) => path)).toEqual(paths);
    expect(log.debug).not.toHaveBeenCalled();
  });

  it("swallows the error thrown outside a request context and keeps going", () => {
    cache.revalidatePath.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing");
    });
    expect(() => revalidateListingPaths({ slugId: "velo-casablanca-abcd2345" })).not.toThrow();
    expect(cache.revalidatePath).toHaveBeenCalledTimes(3);
    expect(log.debug).toHaveBeenCalledTimes(3);
  });
});

describe("other processes and the edge", () => {
  it("publishes the paths for every web process, the worker's changes included", async () => {
    const publish = vi.fn(async () => undefined);
    setRevalidationSinksForTests({ publish, purge: null });
    cache.revalidatePath.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing");
    });
    const paths = revalidateListingPaths({ slugId: "velo-casablanca-abcd2345", publicId: "k7m2p9q4r8" });
    expect(publish).toHaveBeenCalledWith(paths);
    expect(revalidateListingPaths({})).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("never throws when the publish fails: it is logged", async () => {
    setRevalidationSinksForTests({ publish: async () => Promise.reject(new Error("valkey timeout")), purge: null });
    expect(() => revalidateListingPaths({ slugId: "velo-casablanca-abcd2345" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ err: "valkey timeout" }), "ISR invalidation not published");
  });

  it("purges the page URLs at the edge in one request per window", async () => {
    process.env.SITE_URL = "https://aalan.example/";
    resetServerEnv();
    const purge = vi.fn(async (_urls: readonly string[]) => undefined);
    setRevalidationSinksForTests({ publish: null, purge });
    revalidateListingPaths({ slugId: "velo-casablanca-abcd2345" });
    revalidateListingPaths({ slugId: "velo-casablanca-abcd2345", publicId: "k7m2p9q4r8" });
    await flushPagePurgeForTests();
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge.mock.calls[0]?.[0]).toEqual([...listingPagePaths("velo-casablanca-abcd2345"), ...profilePagePaths("k7m2p9q4r8")].map((path) => `https://aalan.example${path}`));
    delete process.env.SITE_URL;
    resetServerEnv();
  });

  it("purges nothing outside production", async () => {
    setRevalidationSinksForTests({ publish: null });
    revalidateListingPaths({ slugId: "velo-casablanca-abcd2345" });
    await flushPagePurgeForTests();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
