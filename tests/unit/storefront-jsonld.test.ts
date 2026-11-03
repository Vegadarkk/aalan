import { describe, expect, it } from "vitest";
import { storefrontJsonLd, type StorefrontJsonLdInput } from "@/lib/seo/jsonld";

// schema.org data of a shop's storefront (UX audit lot 3): the sector's business type, what the
// page shows, never a phone, and a rating only from at least one verified review.

const base: StorefrontJsonLdInput = {
  name: "Maison Lalla",
  sector: "general",
  url: "https://aalan.ma/fr/boutique/maison-lalla-abcd2345",
  description: "Babouches et caftans cousus main.",
  cityName: "Casablanca",
  address: "12 rue des Artisans",
  hours: { days: [{ day: "mon", slots: [{ from: "09:00", to: "12:30" }, { from: "14:00", to: "19:00" }] }] },
  website: "https://maison-lalla.ma",
  sameAs: ["https://www.instagram.com/maisonlalla"],
  rating: { count: 3, average: 4.7 },
};

describe("storefrontJsonLd", () => {
  it("describes the shop as a local business", () => {
    const data = storefrontJsonLd(base);
    expect(data).toMatchObject({
      "@type": "Store",
      name: "Maison Lalla",
      url: base.url,
      address: { "@type": "PostalAddress", streetAddress: "12 rue des Artisans", addressLocality: "Casablanca", addressCountry: "MA" },
      sameAs: ["https://maison-lalla.ma", "https://www.instagram.com/maisonlalla"],
      aggregateRating: { ratingValue: 4.7, reviewCount: 3 },
    });
    expect(data.openingHoursSpecification).toHaveLength(2);
    expect(JSON.stringify(data)).not.toMatch(/telephone|email/);
  });

  it("uses the sector's type and leaves out what the shop did not give", () => {
    const data = storefrontJsonLd({ ...base, sector: "real_estate", description: " ", address: "", hours: null, website: null, sameAs: [], rating: { count: 0, average: null } });
    expect(data["@type"]).toBe("RealEstateAgent");
    for (const key of ["description", "openingHoursSpecification", "sameAs", "aggregateRating"]) expect(data).not.toHaveProperty(key);
    expect(data.address).toEqual({ "@type": "PostalAddress", addressLocality: "Casablanca", addressCountry: "MA" });
  });
});
