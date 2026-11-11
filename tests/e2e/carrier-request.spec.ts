import { expect, test, type Page } from "@playwright/test";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { BLURHASH, firebase, randomId, signUpAndIn, storePhoto } from "./helpers";

// A place request on a carrier's departure and its transport review (transporteurs/spec.md §5-6)
// against the production build and the emulators. The carrier's shop and departure are written
// straight into the emulator (carrier.spec.ts covers the price list): the client sends a basket
// from the listing (an empty one is refused), the thread pins the estimate with the weighing
// notice, the carrier reserves the place, and two days later the client's review carries two tags
// that the storefront shows. Runs with `carriersEnabled` off, as every spec shares the cached flags:
// a place request needs a departure, not the open space.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

async function session(page: Page) {
  return ((await (await page.request.get("/api/auth/me")).json()) as { session: { uid: string; publicId: string } }).session;
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function seed(carrier: { uid: string; publicId: string }) {
  const firestore = getFirestore(firebase());
  const proId = Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
  const now = new Date();
  await firestore
    .collection("proProfiles")
    .doc(proId)
    .set({
      ownerUid: carrier.uid,
      members: { [carrier.uid]: "owner" },
      name: "Rif Express",
      slug: `rif-express-${proId}`,
      description: "Départs chaque semaine de Lyon vers le Rif.",
      whatsapp: false,
      regionCode: "02",
      citySlug: "nador",
      sector: "carrier",
      legal: { form: "entreprise_ue", country: "FR", registry: "73282932000074" },
      kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
      lifecycle: "verified",
      plan: "essentiel",
      planSource: "launch_offer",
      quotas: { activeListings: 50, listingsPerDay: 20, photosPerListing: 15 },
      carrier: {
        licenceRef: "LC 2024/069 001234",
        directions: ["eu_ma"],
        euZones: ["FR-69"],
        maCities: ["nador"],
        pickup: { depot: true, home: true },
        delivery: { depot: false, home: true },
        vehicle: { kind: "van", volumeM3: 20, payloadKg: 1200 },
        transitDays: { min: 3, max: 5 },
        tariff: { currency: "EUR", perKg: 250, bands: [], minimum: 2000, volumetricKgPerM3: null, items: [{ item: "e-scooter", price: 6000 }], surcharges: [] },
        refused: [],
        note: "",
      },
      carrierUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  await firestore.collection("users").doc(carrier.uid).update({ proId, type: "pro" });
  const id = randomId(8);
  const photoId = `e2ephoto${randomId(8)}`;
  const size = await storePhoto(id, photoId);
  const departOn = day(5);
  const slugId = `rhone-nador-${id}`;
  await firestore
    .collection("listings")
    .doc(id)
    .set({
      ownerUid: carrier.uid,
      sellerType: "pro",
      proId,
      sellerName: "Rif Express",
      sellerPublicId: carrier.publicId,
      categoryId: "services",
      subcategoryId: "departs-europe-maroc",
      attributes: { "departure-direction": "europe-maroc" },
      price: null,
      priceNegotiable: false,
      isDonation: false,
      location: { regionCode: "02", citySlug: "nador", geo: { lat: 35.17, lng: -2.93 } },
      contact: { messaging: true, showPhone: false, whatsapp: false },
      boosts: {},
      sortAt: now,
      sortSource: "publish",
      moderation: { state: "auto_ok", score: 5, flags: [], openReports: 0 },
      legalHold: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: "published",
      slugId,
      title: "Rhône → Nador",
      description: "Départ de Lyon, dépôt à Vénissieux, arrivée à Nador.",
      photos: [{ id: photoId, ...size, blurhash: BLURHASH }],
      adsEligible: false,
      publishedAt: now,
      expiresAt: new Date(now.getTime() + 10 * 86_400_000),
      departure: { direction: "eu_ma", departOn, depositBy: departOn, arriveFrom: day(8), arriveTo: day(10), euZones: ["FR-69"], maCities: ["nador"], space: "some", spaceUpdatedAt: now },
    });
  return slugId;
}

test.describe("place request on a carrier's departure", () => {
  test("the client asks for a place, the carrier reserves it, the review carries transport tags", async ({ browser, request }) => {
    test.setTimeout(240_000);
    const stamp = `${Date.now().toString(36)}${randomId(4)}`;
    const carrierContext = await browser.newContext();
    const clientContext = await browser.newContext();
    const carrierPage = await carrierContext.newPage();
    const clientPage = await clientContext.newPage();
    const errors: string[] = [];
    for (const page of [carrierPage, clientPage]) page.on("pageerror", (error) => errors.push(error.message));
    await signUpAndIn(carrierPage, request, `e2e-carrier-${stamp}@aalan.test`, "Rif Express");
    await signUpAndIn(clientPage, request, `e2e-client-${stamp}@aalan.test`, "Samira Envoi");
    const carrier = await session(carrierPage);
    const slugId = await seed(carrier);

    await clientPage.goto(`/fr/annonce/${slugId}`);
    await expect(clientPage.getByTestId("departure-guide")).toHaveAttribute("href", "/fr/demarches/mre#procedure-mre-colis");
    await clientPage.getByTestId("carrier-request-button").first().click();
    const dialog = clientPage.getByRole("dialog");
    await expect(dialog.getByText("rien ne se paie sur Aalan", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: /Demander une place/ }).click();
    await expect(dialog.getByText("Indiquez un poids ou au moins un objet.")).toBeVisible();
    await dialog.getByTestId("carrier-request-kg").fill("20");
    await dialog.getByRole("button", { name: "Plus d'objets" }).click();
    await dialog.getByRole("button", { name: "Ajouter : Trottinette électrique" }).click();
    await dialog.getByText("Collecte à domicile").click();
    await expect(dialog.locator("[data-turnstile]")).toHaveAttribute("data-turnstile", "ready", { timeout: 20_000 });
    await dialog.getByRole("button", { name: /Demander une place/ }).click();
    await expect(clientPage).toHaveURL(/\/fr\/messages\/[A-Za-z0-9_-]{22}$/, { timeout: 20_000 });
    const cid = new URL(clientPage.url()).pathname.split("/").at(-1)!;
    // 20 kg × 2,50 € + the scooter's 60 € = 110 €; home pickup has no price in this list.
    const mine = clientPage.getByTestId("carrier-request-card");
    await expect(mine).toHaveAttribute("data-status", "requested-mine", { timeout: 15_000 });
    await expect(mine.getByTestId("carrier-request-estimate")).toContainText("110,00");
    await expect(mine.getByTestId("carrier-request-notice")).toContainText("pesée de contrôle");

    await carrierPage.goto(`/fr/messages/${cid}`);
    const card = carrierPage.getByTestId("carrier-request-card");
    await expect(card).toHaveAttribute("data-status", "requested-theirs", { timeout: 15_000 });
    await expect(card).toContainText("20 kg de colis, 1 × Trottinette électrique, collecte à domicile");
    await card.getByTestId("carrier-request-accept").click();
    await card.getByTestId("carrier-request-note").fill("Dépôt la veille au soir, pesée sur place.");
    await card.getByTestId("carrier-request-confirm-send").click();
    await expect(card).toHaveAttribute("data-status", "accepted", { timeout: 15_000 });
    await expect(clientPage.getByTestId("carrier-request-card")).toHaveAttribute("data-status", "accepted", { timeout: 40_000 });
    await expect(clientPage.getByTestId("thread").getByText("Dépôt la veille au soir, pesée sur place.")).toBeVisible();

    // Two days later the client reviews the carrier with two transport tags.
    await getFirestore(firebase())
      .collection("conversations")
      .doc(cid)
      .update({ sellerRepliedAt: Timestamp.fromMillis(Date.now() - 2 * 86_400_000) });
    await clientPage.reload();
    await clientPage.getByTestId("review-prompt").getByRole("button", { name: "Donner mon avis" }).click();
    const review = clientPage.getByTestId("review-dialog");
    const tags = review.getByTestId("review-tags");
    await expect(tags).toBeVisible({ timeout: 15_000 });
    await review.locator("label").filter({ hasText: "5 étoiles sur 5" }).click();
    await tags.getByText("Prix respecté", { exact: true }).click();
    await tags.getByText("Colis intact", { exact: true }).click();
    await expect(review.getByRole("checkbox", { name: "Prix respecté" })).toBeChecked();
    await review.getByLabel("Votre avis").fill(`Prix annoncé tenu à la pesée, colis arrivé en bon état à Nador. ${stamp}`);
    await review.getByRole("checkbox", { name: "Nous avons conclu un échange ou une rencontre" }).check();
    await review.getByRole("button", { name: "Publier mon avis" }).click();
    await expect(review.getByRole("heading", { name: "Merci, votre avis est publié" })).toBeVisible({ timeout: 15_000 });

    await clientPage.goto(`/fr/profil/${carrier.publicId}#avis`);
    const block = clientPage.getByTestId("seller-reviews");
    await expect(block.getByTestId("review-tags")).toHaveText(/Prix respecté\s*Colis intact/);
    // One transport review: no percentage yet.
    await expect(block.getByTestId("review-tag-shares")).toHaveCount(0);
    await expect(clientPage.getByText(/Les identifiants professionnels de ce transporteur/)).toBeVisible();

    expect(errors).toEqual([]);
    await carrierContext.close();
    await clientContext.close();
  });
});
