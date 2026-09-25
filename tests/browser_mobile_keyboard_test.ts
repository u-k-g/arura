import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "mobile composer stays above a visual-viewport keyboard when focused",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "App URL"));
      await signIn(page, "Keyboard viewport");
      await expect(page.locator(".app-shell")).toBeVisible();
      const navigation = page.locator(".mobile-composer-navigation");
      await expect(navigation).toBeVisible();
      const composerEntry = await page.locator(".composer-entry").boundingBox();
      const navigationBox = await navigation.boundingBox();
      if (!composerEntry || !navigationBox) throw new Error("Composer layout missing");
      expect(navigationBox.y).toBeGreaterThanOrEqual(
        composerEntry.y + composerEntry.height - 1,
      );
      const input = page.getByRole("textbox", { name: "Message Hermes" });
      await input.focus();
      await page.evaluate(() => {
        const viewport = globalThis.visualViewport;
        if (!viewport) throw new Error("VisualViewport unavailable");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          value: 800,
        });
        Object.defineProperty(viewport, "offsetTop", {
          configurable: true,
          value: 0,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect.poll(async () =>
        await page.locator(".app-shell").evaluate((element) =>
          Math.round(element.getBoundingClientRect().height)
        )
      ).toBe(800);
      await expect.poll(async () =>
        await page.locator(".composer-bottom").evaluate((element) =>
          Math.round(element.getBoundingClientRect().bottom)
        )
      ).toBeLessThanOrEqual(800);
      await page.keyboard.press("Meta+k");
      await expect(page.locator(".command-palette")).toBeVisible();
      const normalResultsHeight = await page.locator(".palette-results")
        .evaluate((element) => Math.round(element.getBoundingClientRect().height));
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const viewport = globalThis.visualViewport;
        if (!viewport) throw new Error("VisualViewport unavailable");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          value: 430,
        });
        Object.defineProperty(viewport, "offsetTop", {
          configurable: true,
          value: 16,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect.poll(async () =>
        await page.locator(".compose-area").evaluate((element) =>
          Math.round(element.getBoundingClientRect().bottom)
        )
      ).toBeLessThanOrEqual(446);
      await expect(input).toBeVisible();
      await page.keyboard.press("Meta+k");
      await expect(page.locator(".command-palette")).toBeVisible();
      await expect.poll(async () =>
        await page.locator(".palette-results").evaluate((element) =>
          Math.round(element.getBoundingClientRect().height)
        )
      ).toBeGreaterThanOrEqual(normalResultsHeight - 2);
      await expect.poll(async () =>
        await page.locator(".command-palette").evaluate((element) =>
          Math.round(element.getBoundingClientRect().bottom)
        )
      ).toBeLessThanOrEqual(446);
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const viewport = globalThis.visualViewport;
        if (!viewport) throw new Error("VisualViewport unavailable");
        Reflect.deleteProperty(viewport, "height");
        Reflect.deleteProperty(viewport, "offsetTop");
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect.poll(async () =>
        await page.locator(".app-shell").evaluate((element) =>
          Math.round(element.getBoundingClientRect().height)
        )
      ).toBe(844);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
});
