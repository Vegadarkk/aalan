import { expect, test, type Page } from "@playwright/test";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { PASSWORD, firebase, randomId, signUpAndIn } from "./helpers";

// Europe–Morocco carriers, lot 1 (transporteurs/spec.md §3-4) against the production build and the
// Firebase emulators: a verified carrier registered in France fills its price list at
// /fr/pro/transport (licence, routes, collection, vehicle, per-kg rate and bands, item prices,
// surcharges, refused goods), sees the quote simulator, and its storefront shows the price list.
// The shop is written straight into the emulator (carrier-apply covers the application).
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

async function waitForTurnstile(page: Page): Promise<void> {
  const widget = page.locator("[data-turnstile]");
  if ((await widget.count()) > 0) await expect(widget.first()).toHaveAttribute("data-turnstile", "ready", { timeout: 20_000 });
}

async function seedCarrier(email: string, shopName: string): Promise<string> {
  const app = firebase();
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const { uid } = await auth.getUserByEmail(email);
  const proId = randomId(8);
  const slug = `${shopName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-nador`;
  const now = new Date();
  await firestore.collection("proProfiles").doc(proId).set({
    ownerUid: uid,
    members: { [uid]: "owner" },
    name: shopName,
    slug,
    description: "Départs chaque semaine de Lyon vers le Rif et l'Oriental.",
    whatsapp: false,
    regionCode: "02",
    citySlug: "nador",
    sector: "carrier",
    sectorCommitment: { sector: "carrier", version: "2026-11-10", at: now },
    legal: { form: "entreprise_ue", country: "FR", registry: "73282932000074" },
    kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
    lifecycle: "verified",
    plan: "essentiel",
    planSource: "launch_offer",
    quotas: { activeListings: 50, listingsPerDay: 20, photosPerListing: 15 },
    createdAt: now,
    updatedAt: now,
  });
  await firestore.collection("users").doc(uid).update({ proId, type: "pro", "badges.phoneVerified": true, updatedAt: now });
  await auth.setCustomUserClaims(uid, { role: "pro", proId, proRole: "owner", v: 2 });
  await auth.revokeRefreshTokens(uid);
  return `${slug}-${proId}`;
}

test.describe("Europe–Morocco carrier", () => {
  test("a carrier publishes its price list, simulates a quote and shows it on its storefront", async ({ page, request }) => {
    test.setTimeout(150_000);
    const email = `transport-${randomId(10)}@aalan.test`;
    await signUpAndIn(page, request, email, "Youssef Transport");
    const segment = await seedCarrier(email, `Rif Express ${randomId(4)}`);

    await page.context().clearCookies();
    await page.goto("/fr/pro");
    await expect(page).toHaveURL(/\/connexion/);
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
    await waitForTurnstile(page);
    await page.getByRole("button", { name: "Se connecter" }).click();
    const setup = page.getByTestId("carrier-setup");
    await expect(setup).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("agency-settings")).toHaveCount(0);
    await setup.getByRole("link", { name: "Remplir ma grille" }).click();

    const form = page.getByTestId("carrier-settings");
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.getByRole("button", { name: "Enregistrer la grille" }).click();
    await expect(form.getByText("Corrigez les champs signalés avant d'enregistrer.")).toBeVisible();

    await form.getByLabel("Numéro de licence").fill("2024/069/0001234");
    await form.getByRole("checkbox", { name: "Maroc → Europe" }).click();
    await form.getByRole("checkbox", { name: /^Rhône/ }).check();
    await form.getByRole("checkbox", { name: /^Isère/ }).check();
    await form.getByTestId("carrier-zone-country").selectOption("BE");
    await form.getByRole("button", { name: "Tout le pays" }).click();
    await expect(form.getByText("13 zones choisies.")).toBeVisible();
    for (const city of ["Nador", "Oujda"]) {
      const combo = form.locator('input[role="combobox"]');
      await combo.fill(city);
      await page.getByRole("option", { name: new RegExp(`^${city}`) }).first().click();
    }
    await expect(form.getByTestId("carrier-cities").getByRole("listitem")).toHaveCount(2);
    await form.getByLabel("Prix au kg (€)").first().fill("2,50");
    await form.getByLabel("Minimum (€)").fill("20");
    await form.getByRole("button", { name: "Ajouter un palier" }).click();
    await form.getByTestId("carrier-band").getByLabel("Prix au kg (€)").fill("2");
    await form.getByLabel("Prix fixe : Trottinette électrique").fill("60");
    await form.getByLabel("Refuser : Moto ou scooter").check();
    await form.getByLabel("Collecte à domicile (€)").fill("10");
    await form.getByLabel("Haute saison (%)").fill("15");
    await form.getByRole("checkbox", { name: "Batteries lithium" }).click();

    // 15 kg of boxes + 2 suitcases (46 kg) = 61 kg from the 60 kg band at 2,00 €, plus the scooter.
    await expect(form.getByTestId("carrier-simulator-total")).toContainText("182,00");
    await form.getByRole("button", { name: "Enregistrer la grille" }).click();
    await expect(page.getByText("Grille enregistrée")).toBeVisible();
    await expect(form.getByText(/Votre vitrine est à jour\. Grille mise à jour le/)).toBeVisible();
    await page.screenshot({ path: "test-results/carrier-settings.png", fullPage: true });

    await page.goto(`/fr/boutique/${segment}`);
    const card = page.getByTestId("carrier-card");
    await expect(card.getByTestId("carrier-licence")).toHaveText("2024/069/0001234");
    await expect(card).toContainText("Europe → Maroc · Maroc → Europe");
    const prices = page.getByTestId("carrier-prices");
    await expect(prices.getByTestId("carrier-from")).toContainText("2,00");
    await expect(prices).toContainText("Trottinette électrique");
    await expect(prices).toContainText("Bruxelles-Capitale");
    await expect(prices.getByTestId("carrier-refused")).toContainText("Moto ou scooter, Batteries lithium");
    await prices.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/carrier-storefront.png", fullPage: true });
  });
});
