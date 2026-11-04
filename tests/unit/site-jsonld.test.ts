import { describe, expect, it } from "vitest";
import { siteJsonLd } from "@/lib/seo/jsonld";

describe("siteJsonLd", () => {
  const ld = siteJsonLd({
    origin: "https://aalan.ma/",
    locale: "ar",
    inLanguage: "ar-MA",
    name: "Aalan",
    alternateNames: ["أعلان", "ⴰⵄⵍⴰⵏ"],
    description: "desc",
    searchPath: "/recherche",
  });
  const [site, org] = (ld["@graph"] as Record<string, unknown>[]) ?? [];

  it("describes the website of the page's locale with a search box on /recherche?q=", () => {
    expect(ld["@context"]).toBe("https://schema.org");
    expect(site).toMatchObject({ "@type": "WebSite", "@id": "https://aalan.ma/ar#website", url: "https://aalan.ma/ar", inLanguage: "ar-MA", name: "Aalan" });
    expect(site?.potentialAction).toEqual({
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: "https://aalan.ma/ar/recherche?q={search_term_string}" },
      "query-input": "required name=search_term_string",
    });
  });

  it("links the website to one Organization with the brand spellings and an absolute logo", () => {
    expect(site?.publisher).toEqual({ "@id": "https://aalan.ma/#organization" });
    expect(org).toMatchObject({ "@type": "Organization", "@id": "https://aalan.ma/#organization", url: "https://aalan.ma", logo: "https://aalan.ma/brand/icon-512.png" });
    expect(org?.alternateName).toEqual(["أعلان", "ⴰⵄⵍⴰⵏ"]);
  });
});
