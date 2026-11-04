import { expect, test, type Page } from "@playwright/test";
import { getFirestore } from "firebase-admin/firestore";
import { BLURHASH, firebase, randomId, storePhoto } from "./helpers";

// Paper (audit zone 8, impression 3): the CGU printed on 37 A4 pages with the header, the menus and
// the 182-link footer; a listing on 6. The print stylesheet (src/styles/globals.css) keeps the
// page's own content, its version and its address, and a listing's first photo.

/** Pages of a PDF: its /Type /Page objects (not /Pages). */
async function pdfPages(page: Page): Promise<number> {
  const pdf = (await page.pdf({ format: "A4" })).toString("latin1");
  return pdf.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

async function seedListing(): Promise<string> {
  const firestore = getFirestore(firebase());
  const uid = `e2e-print-${randomId(12)}`;
  const publicId = randomId(10);
  const now = new Date();
  await firestore.collection("users").doc(uid).set({
    publicId,
    displayName: "Nadia Test",
    type: "individual",
    citySlug: "fes",
    badges: { emailVerified: true, phoneVerified: true, proCertified: false },
    stats: { activeListings: 1, responseRate: 0, medianReplyMin: 0, ratingCount: 0 },
    status: "active",
    activation: "done",
    locale: "fr",
    createdAt: new Date("2025-10-05T12:00:00.000Z"),
    updatedAt: now,
  });
  const id = randomId(8);
  const slugId = `robe-en-lin-fes-${id}`;
  const photos = [];
  for (const [index, color] of [{ r: 196, g: 120, b: 52 }, { r: 34, g: 94, b: 74 }, { r: 60, g: 60, b: 160 }].entries()) {
    const photoId = `e2eprint${index}${randomId(6)}`;
    photos.push({ id: photoId, ...(await storePhoto(id, photoId, color)), blurhash: BLURHASH });
  }
  await firestore.collection("listings").doc(id).set({
    ownerUid: uid,
    sellerType: "individual",
    sellerName: "Nadia Test",
    sellerPublicId: publicId,
    status: "published",
    slugId,
    title: "Robe d'été en lin",
    description: "Robe en lin lavé, ceinture cordon. Portée deux fois.\n\nÀ voir à Fès.",
    categoryId: "mode",
    subcategoryId: "vetements",
    attributes: {},
    condition: "very_good",
    price: 250,
    priceNegotiable: false,
    isDonation: false,
    location: { regionCode: "03", citySlug: "fes", geo: { lat: 34.03, lng: -5.0 } },
    photos,
    contact: { messaging: true, showPhone: false, whatsapp: false },
    boosts: {},
    sortAt: now,
    sortSource: "publish",
    moderation: { state: "auto_ok", score: 5, flags: [], openReports: 0 },
    adsEligible: true,
    publishedAt: now,
    expiresAt: new Date(now.getTime() + 60 * 86_400_000),
    legalHold: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  return slugId;
}

test.describe("print", () => {
  test("the CGU print as text: no header, menus, footer or contents, with their version and address", async ({ page }) => {
    await page.goto("/fr/legal/cgu");
    await expect(page.getByTestId("legal-version")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("header.header-lift").first()).toBeHidden();
    await expect(page.locator("footer")).toBeHidden();
    await expect(page.locator("nav[aria-labelledby=legal-toc]")).toBeHidden();
    await expect(page.getByTestId("legal-version")).toBeVisible();
    await expect(page.getByText(/^Adresse de la page :/)).toContainText(/http:\/\/localhost:\d+\/fr\/legal\/cgu$/);
    // 37 pages before the print stylesheet, 24 with it (about 11 600 words).
    const pages = await pdfPages(page);
    expect(pages).toBeGreaterThan(5);
    expect(pages).toBeLessThanOrEqual(26);
  });

  test("a listing prints its first photo, its text and its address, without controls", async ({ page }) => {
    const slugId = await seedListing();
    await page.goto(`/fr/annonce/${slugId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Robe d'été en lin" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const gallery = page.getByTestId("gallery");
    await expect(gallery.locator("li img:visible")).toHaveCount(1);
    await expect(page.getByTestId("listing-description")).toBeVisible();
    await expect(page.getByText(/^Adresse de l'annonce :/)).toContainText(`/fr/annonce/${slugId}`);
    // No control prints: the only buttons left showing hold the first photo.
    const controls = await page.evaluate(() => [...document.querySelectorAll("#main button")].filter((button) => button.getClientRects().length > 0 && !button.closest("[data-testid=gallery]")).length);
    expect(controls).toBe(0);
    await expect(page.locator("#signaler")).toBeHidden();
    expect(await pdfPages(page)).toBeLessThanOrEqual(2);
  });
});
