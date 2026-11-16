import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, type Page } from "@playwright/test";
import { KhatamLoader } from "@/components/ui/khatam-loader";

// Geometry of the loading mark as the browser paints it (the site's CSS, still under reduced
// motion): the two squares of the khatam share one centre, and the star sits in the middle of its
// box, at 1x and 2x, light and dark, LTR and RTL, on whole and fractional positions. Measured from
// the pixels (ink centroid of each square), so it needs no baseline image.

type Size = "inline" | "sm" | "md" | "lg";
const SIZES: Size[] = ["inline", "sm", "md", "lg"];
const POSITIONS = [
  [40, 40],
  [40.3, 40.6],
  [40.5, 40.5],
] as const;

interface Measure {
  /** Distance between the centroids of the two squares, CSS px. */
  between: number;
  /** Distance from the star's centroid to the centre of its box, CSS px. */
  offCentre: number;
  /** Ink outside the box. */
  outside: number;
}

async function measure(page: Page, size: Size, [left, top]: readonly [number, number]): Promise<Measure> {
  const markup = renderToStaticMarkup(createElement(KhatamLoader, { size }));
  await page.evaluate(
    ({ markup, left, top }) => {
      document.getElementById("khatam-probe")?.remove();
      const probe = document.createElement("div");
      probe.id = "khatam-probe";
      probe.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:var(--background);font-size:16px`;
      probe.innerHTML = `<div style="position:absolute;left:${left}px;top:${top}px;line-height:0">${markup}</div>`;
      document.body.append(probe);
    },
    { markup, left, top },
  );
  const mark = page.locator("#khatam-probe [data-loader=khatam]");
  const box = await mark.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const clip = { x: Math.floor(box.x) - 8, y: Math.floor(box.y) - 8, width: Math.ceil(box.width) + 16, height: Math.ceil(box.height) + 16 };
  const shot = async (hide: number | null) => {
    await mark.evaluate((element, hide) => element.querySelectorAll("rect").forEach((rect, index) => (rect.style.visibility = index === hide ? "hidden" : "")), hide);
    return (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
  };
  const [both, first, second] = [await shot(null), await shot(1), await shot(0)];
  return page.evaluate(
    async ({ both, first, second, clip, box }) => {
      const ink = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
        const scale = width / clip.width;
        const ground = [data[0]!, data[1]!, data[2]!];
        let total = 0;
        let sx = 0;
        let sy = 0;
        let outside = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const at = (y * width + x) * 4;
            const value = Math.abs(data[at]! - ground[0]!) + Math.abs(data[at + 1]! - ground[1]!) + Math.abs(data[at + 2]! - ground[2]!);
            const px = clip.x + (x + 0.5) / scale;
            const py = clip.y + (y + 0.5) / scale;
            total += value;
            sx += value * px;
            sy += value * py;
            if (px < box.x - 1 || px > box.x + box.width + 1 || py < box.y - 1 || py > box.y + box.height + 1) outside += value;
          }
        }
        return { x: sx / total, y: sy / total, total, outside };
      };
      const [all, a, b] = [await ink(both), await ink(first), await ink(second)];
      return {
        between: Math.hypot(a.x - b.x, a.y - b.y),
        offCentre: Math.hypot(all.x - (box.x + box.width / 2), all.y - (box.y + box.height / 2)),
        outside: all.outside / all.total,
      };
    },
    { both, first, second, clip, box },
  );
}

for (const deviceScaleFactor of [1, 2]) {
  for (const theme of ["light", "dark"] as const) {
    for (const locale of ["fr", "ar"] as const) {
      test(`khatam loader: concentric and centred (${deviceScaleFactor}x, ${theme}, ${locale})`, async ({ browser }) => {
        const context = await browser.newContext({ deviceScaleFactor, reducedMotion: "reduce", colorScheme: theme, viewport: { width: 400, height: 300 } });
        const page = await context.newPage();
        expect((await page.goto(`/${locale}/aide`))?.status()).toBe(200);
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === "ar" ? "rtl" : "ltr");
        for (const size of SIZES) {
          for (const position of POSITIONS) {
            const result = await measure(page, size, position);
            const where = `${size} at ${position.join(",")}`;
            // Both squares around one point (the former CSS borders drifted up to 0.7 px apart).
            expect(result.between, where).toBeLessThan(0.15);
            // The star in the middle of its box, within the half pixel per axis the box snaps by.
            expect(result.offCentre, where).toBeLessThan(0.75);
            expect(result.outside, where).toBeLessThan(0.001);
          }
        }
        await context.close();
      });
    }
  }
}
