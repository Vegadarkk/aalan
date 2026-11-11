import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomId, signUpAndIn } from "./helpers";

// Guided tours (owner, 2026-11-11): the first visit of the posting screen dims the page around the
// step's element and a card explains it; the tour is skipped with Escape or finished, then never
// comes back by itself; the settings switch it off or bring every tour back; the tutorials page
// replays one. The config's default device has tours off: these tests start from an empty one.

const empty = { cookies: [], origins: [] };

const card = (page: Page) => page.getByTestId("tour-card");

/** The hole of the veil sits around the element: its clip-path names the element's box. */
async function holeAround(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target) => {
    const veil = document.querySelector<HTMLElement>(".tour-veil");
    const element = document.querySelector<HTMLElement>(target);
    if (!veil || !element) return false;
    const box = element.getBoundingClientRect();
    const halo = document.querySelector<HTMLElement>(".tour-halo")!.getBoundingClientRect();
    return veil.style.clipPath.startsWith("path(evenodd") && Math.abs(halo.left - (box.left - 8)) < 3 && Math.abs(halo.top - (box.top - 8)) < 3;
  }, selector);
}

test.describe("guided tours", () => {
  test.use({ storageState: empty });

  test("@mobile the posting tour: shown once, step by step, the element sharp in the hole", async ({ page, request }) => {
    await signUpAndIn(page, request, `tour-${randomId(8)}@example.test`);
    await page.goto("/fr/deposer?nouveau=1");
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await expect(card(page)).toHaveAttribute("role", "dialog");
    await expect(card(page).getByRole("heading", { name: "Vous donnez un objet ?" })).toBeVisible();
    await expect(card(page)).toContainText("Étape 1 sur 2");
    await expect(card(page)).toBeFocused();
    await expect.poll(() => holeAround(page, '[data-tour="post-give"]')).toBe(true);

    // Accessibility of the open tour (WCAG 2.1 AA).
    const results = await new AxeBuilder({ page }).include('[data-testid="tour"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await page.getByTestId("tour-next").click();
    await expect(card(page).getByRole("heading", { name: "Choisissez la catégorie" })).toBeVisible();
    await expect(card(page)).toContainText("Étape 2 sur 2");
    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour")).toHaveCount(0);

    // Seen: not again on this device, and the account knows it.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Déposer une annonce" }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("tour")).toHaveCount(0);
    const saved = await page.evaluate(async () => (await fetch("/api/account/tutorials")).json());
    expect(saved.seen).toContain("post-start");
  });

  test("Escape skips, Tab stays in the card, the settings bring the tours back or switch them off", async ({ page, request }) => {
    await signUpAndIn(page, request, `tour-${randomId(8)}@example.test`);
    await page.goto("/fr/deposer?nouveau=1");
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Tab");
      expect(await card(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour")).toHaveCount(0);

    await page.goto("/fr/parametres");
    const section = page.getByRole("region", { name: "Tutoriels guidés" });
    await expect(section.getByRole("switch", { name: "Afficher les tutoriels" })).toBeChecked();
    await section.getByRole("button", { name: "Revoir tous les tutoriels" }).click();
    await expect(page.getByText("Les tutoriels s'afficheront de nouveau")).toBeVisible();
    await page.goto("/fr/deposer?nouveau=1");
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    await page.goto("/fr/parametres");
    await section.getByRole("button", { name: "Revoir tous les tutoriels" }).click();
    await expect(page.getByText("Les tutoriels s'afficheront de nouveau")).toBeVisible();
    await section.getByRole("switch", { name: "Afficher les tutoriels" }).click();
    await expect(section.getByRole("switch", { name: "Afficher les tutoriels" })).not.toBeChecked();
    await page.goto("/fr/deposer?nouveau=1");
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("tour")).toHaveCount(0);

    // The tutorials page replays one even with the tours off.
    await page.goto("/fr/aide/tutoriels");
    await page.getByTestId("tutorial-deposer").click();
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/fr\/deposer\?nouveau=1$/);
  });

  test("Arabic: the card reads right to left", async ({ page, request }) => {
    await signUpAndIn(page, request, `tour-${randomId(8)}@example.test`);
    await page.goto("/ar/deposer?nouveau=1");
    await expect(card(page)).toBeVisible({ timeout: 15_000 });
    await expect(card(page).getByRole("heading", { name: "هل تتبرّع بغرض؟" })).toBeVisible();
    expect(await card(page).evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
  });
});
