import { expect, test, type Page } from "@playwright/test";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { BLURHASH, PASSWORD, firebase, pickRentalDays, randomId, signUpAndIn, storePhoto } from "./helpers";

// Seasonal rental agencies (conception §1-2) against the production build and the Firebase
// emulators: a verified shop becomes a seasonal rental agency from /fr/pro once it ticks the
// trade's legal commitments (with the guide's tourist-rental procedure linked), its storefront
// says so, and the holiday homes search asks for stay dates (arrival, departure); a guest asks for a
// stay on one of its homes, the agency accepts and the nights are blocked (conception §3). The shop
// and the home are written straight into the emulator (pro.spec covers the application).
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

async function waitForTurnstile(page: Page): Promise<void> {
  const widget = page.locator("[data-turnstile]");
  if ((await widget.count()) > 0) await expect(widget.first()).toHaveAttribute("data-turnstile", "ready", { timeout: 20_000 });
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A verified general shop on the launch offer for the member, and a holiday home it published. */
async function seedShop(email: string, shopName: string): Promise<{ segment: string; slugId: string; title: string }> {
  const app = firebase();
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const { uid } = await auth.getUserByEmail(email);
  const proId = randomId(8);
  const slug = `${shopName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-agadir`;
  const now = new Date();
  await firestore.collection("proProfiles").doc(proId).set({
    ownerUid: uid,
    members: { [uid]: "owner" },
    name: shopName,
    slug,
    description: "Appartements meublés en bord de mer.",
    whatsapp: false,
    regionCode: "09",
    citySlug: "agadir",
    legal: { form: "societe", ice: "001234567000089", rc: "54321", if: "7654321" },
    kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
    lifecycle: "verified",
    plan: "essentiel",
    planSource: "launch_offer",
    quotas: { activeListings: 50, listingsPerDay: 20, photosPerListing: 15 },
    createdAt: now,
    updatedAt: now,
  });
  const user = firestore.collection("users").doc(uid);
  await user.update({ proId, type: "pro", "badges.phoneVerified": true, updatedAt: now });
  const { publicId, displayName } = (await user.get()).data() as { publicId: string; displayName: string };
  await auth.setCustomUserClaims(uid, { role: "pro", proId, proRole: "owner", v: 2 });
  await auth.revokeRefreshTokens(uid);

  const id = randomId(8);
  const title = `Appartement face à la mer ${randomId(4)}`;
  const slugId = `appartement-face-a-la-mer-agadir-${id}`;
  const photoId = `e2ephotoh${randomId(6)}`;
  await firestore
    .collection("listings")
    .doc(id)
    .set({
      ownerUid: uid,
      proId,
      sellerType: "pro",
      sellerName: displayName,
      sellerPublicId: publicId,
      status: "published",
      slugId,
      title,
      description: "Deux chambres, terrasse face à la mer, à cinq minutes de la plage.\n\nLinge fourni.",
      categoryId: "immobilier",
      subcategoryId: "location-vacances",
      attributes: { "property-type": "appartement", bedrooms: 2 },
      price: 900,
      priceNegotiable: false,
      isDonation: false,
      location: { regionCode: "09", citySlug: "agadir", geo: { lat: 30.42, lng: -9.6 } },
      photos: [{ id: photoId, ...(await storePhoto(id, photoId, { r: 120, g: 180, b: 200 })), blurhash: BLURHASH }],
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
  return { segment: `${slug}-${proId}`, slugId, title };
}

test.describe("seasonal rental agency", () => {
  test("a shop becomes a seasonal rental agency after its commitments; holiday homes search by stay dates; a guest asks for a stay", async ({ page, request, browser }) => {
    test.setTimeout(180_000);
    const email = `saison-${randomId(10)}@aalan.test`;
    await signUpAndIn(page, request, email, "Karim Saison");
    const { segment, slugId, title } = await seedShop(email, `Souss Séjours ${randomId(4)}`);

    // New claims: sign in again for a token carrying the shop (see agency.spec).
    await page.context().clearCookies();
    await page.goto("/fr/pro");
    await expect(page).toHaveURL(/\/connexion/);
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
    await waitForTurnstile(page);
    await page.getByRole("button", { name: "Se connecter" }).click();
    const settings = page.getByTestId("agency-settings");
    await expect(settings).toBeVisible({ timeout: 15_000 });
    await settings.getByRole("radio", { name: /Location saisonnière/ }).check();
    await settings.getByRole("button", { name: "Enregistrer" }).click();
    await expect(settings.getByText("Cochez la case pour confirmer vos engagements.")).toBeVisible();
    const commitments = settings.getByTestId("pro-commitments");
    await expect(commitments.getByRole("link", { name: /Louer un logement à des touristes/ })).toHaveAttribute("href", "/fr/demarches/immobilier#procedure-immo-location-touristique");
    await commitments.getByRole("checkbox", { name: /J'accepte ces engagements d'agence de location saisonnière/ }).check();
    await settings.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Secteur enregistré. Votre vitrine est mise à jour.")).toBeVisible();
    await page.screenshot({ path: "test-results/holiday-agency-settings.png", fullPage: true });

    await page.goto(`/fr/boutique/${segment}`);
    const header = page.getByTestId("storefront-header");
    await expect(header.getByText("Agence de location saisonnière", { exact: true })).toBeVisible();
    await expect(header.getByText("Agence vérifiée")).toBeVisible();

    // The guide procedure the commitments link to is on its rubric page.
    await page.goto("/fr/demarches/immobilier#procedure-immo-location-touristique");
    await expect(page.locator("#procedure-immo-location-touristique")).toBeVisible();

    await page.goto("/fr/recherche?sous-categorie=location-vacances");
    const bar = page.locator("#main").getByTestId("rental-dates-bar");
    await expect(bar.getByRole("heading", { name: "Vos dates de séjour" })).toBeVisible();
    await expect(bar.getByLabel("Arrivée")).toBeVisible();
    await expect(bar.getByLabel("Départ")).toBeVisible();
    await expect(bar.getByRole("button", { name: "Voir les logements libres" })).toBeDisabled();
    await page.screenshot({ path: "test-results/holiday-search.png", fullPage: true });

    // A guest asks for a stay (3 nights): the host's card, "Disponible" blocks the nights.
    // On a touch screen (owner's tablet report, 3 Nov 2026): the nights are tapped on the listing's
    // calendar, which opens the request on them; the keyboard then moves the departure in the
    // dialog's own calendar and back.
    const guestContext = await browser.newContext({ hasTouch: true });
    const guest = await guestContext.newPage();
    await signUpAndIn(guest, request, `saison-guest-${randomId(10)}@aalan.test`, "Imane Voyageuse");
    await guest.goto(`/fr/annonce/${slugId}`);
    await expect(guest.getByTestId("visit-button")).toHaveCount(0);
    // A stay's own guide and safety tips (audit L4-12).
    await expect(guest.getByTestId("rental-guide").getByRole("heading", { name: "Louer un logement de vacances au Maroc" })).toBeVisible();
    await expect(guest.getByTestId("safety-tips")).not.toContainText("titre foncier");
    const listingCalendar = guest.getByTestId("rental-availability");
    await listingCalendar.locator(`button[data-day="${day(5)}"]`).tap();
    await expect(guest.getByTestId("rental-availability-pick")).toContainText("Choisissez maintenant le jour de départ.");
    await listingCalendar.locator(`button[data-day="${day(8)}"]`).tap();
    await expect(guest.getByTestId("rental-availability-pick")).toContainText("(3 nuits)");
    await listingCalendar.scrollIntoViewIfNeeded();
    await guest.screenshot({ path: "test-results/holiday-calendar-pick.png" });
    await guest.getByTestId("rental-availability-request").tap();
    const compose = guest.getByTestId("message-dialog");
    await expect(compose.getByRole("heading", { name: /Demande de séjour/ })).toBeVisible();
    await expect(compose.getByLabel("Arrivée")).toHaveAttribute("data-value", day(5));
    await expect(compose.getByLabel("Départ")).toHaveAttribute("data-value", day(8));
    await compose.getByLabel("Départ").focus();
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("rental-dates-hint")).toHaveText("Choisissez maintenant le jour de départ");
    await expect(guest.getByTestId("rental-dates-calendar").locator(`button[data-day="${day(8)}"]`)).toBeFocused();
    await guest.keyboard.press("ArrowRight");
    await guest.keyboard.press("Enter");
    await expect(compose.getByLabel("Départ")).toHaveAttribute("data-value", day(9));
    await expect(compose.getByLabel("Départ")).toBeFocused();
    await pickRentalDays(compose, "Départ", day(8));
    await expect(compose.getByLabel("Départ")).toHaveAttribute("data-value", day(8));
    await compose.getByLabel("Précisions (facultatif)").fill("2 adultes, arrivée vers 18 h");
    await compose.getByLabel("Voyageurs").selectOption("2");
    await expect(compose.getByLabel("Votre message")).toHaveValue(new RegExp(`séjourner à « ${title} » aux dates de ma demande\\. Est-ce disponible \\? Nous serons 2 voyageurs\\.$`, "u"));
    await expect(compose.locator("[data-turnstile]")).toHaveAttribute("data-turnstile", "ready", { timeout: 20_000 });
    await guest.screenshot({ path: "test-results/holiday-request-compose.png" });
    await compose.getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(guest).toHaveURL(/\/fr\/messages\/[A-Za-z0-9_-]{22}$/, { timeout: 20_000 });
    const cid = new URL(guest.url()).pathname.split("/").at(-1)!;
    await expect(guest.getByTestId("rental-request-card")).toHaveAttribute("data-status", "requested-mine", { timeout: 15_000 });
    await expect(guest.getByTestId("rental-request-card")).toContainText("En attente de la réponse de l'annonceur.");
    await expect(guest.getByTestId("rental-request-event").first()).toContainText("Vous avez demandé un séjour");

    // The agency's Pro area (audit L4-02, L4-06): the guide for its homes, the request waiting for
    // its answer, its settings (shown on the storefront) and the planning of its homes.
    await page.goto("/fr/pro");
    await expect(page.getByTestId("rental-setup")).toHaveAttribute("data-kind", "homes");
    const requests = page.getByTestId("rental-requests");
    await expect(requests.getByTestId("rental-requests-pending")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await expect(requests.getByTestId("rental-requests-item")).toHaveAttribute("href", `/fr/messages/${cid}`);
    await page.screenshot({ path: "test-results/holiday-pro-space.png", fullPage: true });
    await page.getByRole("link", { name: "Mon agence de séjours" }).click();
    const holiday = page.getByTestId("holiday-agency-settings");
    await holiday.getByLabel("Numéro d'autorisation").fill("ts 12/2025");
    await holiday.getByLabel("Séjour minimum").selectOption("3");
    await holiday.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Réglages enregistrés. Votre vitrine est mise à jour.")).toBeVisible();
    await page.goto("/fr/pro/logements");
    await expect(page.getByRole("heading", { name: "Planning des logements" })).toBeVisible();
    await expect(page.getByRole("grid", { name: "Disponibilités des logements, nuit par nuit" })).toContainText(title, { timeout: 15_000 });
    await page.goto(`/fr/boutique/${segment}`);
    await expect(page.getByTestId("holiday-authorization")).toHaveText("TS 12/2025");
    await expect(page.getByTestId("holiday-agency")).toContainText("3 nuits");

    await page.goto(`/fr/messages/${cid}`);
    const requestCard = page.getByTestId("rental-request-card");
    await expect(requestCard).toHaveAttribute("data-status", "requested-theirs", { timeout: 15_000 });
    await expect(requestCard).toContainText("3 nuits");
    await expect(requestCard).toContainText(/Précisions : \u2068?2 adultes, arrivée vers 18 h/u);
    await expect(requestCard.getByTestId("rental-request-guests")).toHaveText("2 voyageurs");
    await page.screenshot({ path: "test-results/holiday-request-host.png" });
    await requestCard.getByTestId("rental-request-accept").click();
    await requestCard.getByTestId("rental-request-confirm-send").click();
    await expect(requestCard).toHaveAttribute("data-status", "accepted", { timeout: 15_000 });
    await expect(requestCard).toContainText("Nuits bloquées sur l'annonce.");
    // A stay's next step: the arrival time (audit L4-08).
    await expect(requestCard.getByTestId("rental-request-pickup")).toHaveText("Proposer l'heure d'arrivée");
    await page.goto(`/fr/annonce/${slugId}`);
    const availability = page.getByTestId("rental-availability");
    await expect(availability.locator(`[data-day="${day(7)}"]`)).toHaveAttribute("data-state", "blocked");
    await expect(availability.locator(`[data-day="${day(8)}"]`)).not.toHaveAttribute("data-state", "blocked");

    // An example listing (staging's demo, never contactable): its calendar picks nights too, by
    // touch, and says no request can go (owner's iPad test of 3 Nov 2026).
    const listings = getFirestore(firebase()).collection("listings");
    const source = (await listings.where("slugId", "==", slugId).limit(1).get()).docs[0]!;
    const exampleId = randomId(8);
    const exampleSlugId = `appartement-exemple-agadir-${exampleId}`;
    await listings.doc(exampleId).set({ ...source.data(), slugId: exampleSlugId, example: true, rental: { unavailable: [], updatedAt: new Date() } });
    await guest.goto(`/fr/annonce/${exampleSlugId}`);
    const exampleCalendar = guest.getByTestId("rental-availability");
    await exampleCalendar.locator(`button[data-day="${day(5)}"]`).tap();
    await exampleCalendar.locator(`button[data-day="${day(7)}"]`).tap();
    const examplePick = guest.getByTestId("rental-availability-pick");
    await expect(examplePick).toContainText("(2 nuits)");
    await expect(examplePick).toContainText("Annonce exemple : aucune demande ne peut être envoyée.");
    await expect(guest.getByTestId("rental-availability-request")).toHaveCount(0);
    await guestContext.close();
  });
});
