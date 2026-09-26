import { chromium, expect, type Page } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

const offerUpdate = async (page: Page, build: string) => {
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), build },
    });
  });
  await page.evaluate(() =>
    globalThis.document.dispatchEvent(new Event("visibilitychange"))
  );
};

Deno.test({
  name: "desktop and mobile prompt to reload when their running build is old",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL");
    try {
      const desktop = await browser.newPage({
        viewport: { width: 1100, height: 700 },
      });
      await desktop.goto(url);
      await signIn(desktop, "Desktop update prompt");
      const desktopPrompt = desktop.locator(".update-toast");
      await expect(desktopPrompt).toHaveCount(0);
      await offerUpdate(desktop, "new-desktop-build");
      await expect(desktopPrompt).toContainText("New Arura version ready");
      await desktopPrompt.getByRole("button", { name: "Later" }).click();
      await offerUpdate(desktop, "new-desktop-build");
      await expect(desktopPrompt).toHaveCount(0);

      const mobile = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await mobile.route("**/api/bootstrap", async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: { ...(await response.json()), build: "new-mobile-build" },
        });
      });
      await mobile.goto(url);
      await signIn(mobile, "Mobile update prompt");
      const mobilePrompt = mobile.locator(".update-toast");
      await expect(mobilePrompt).toBeVisible();
      await expect(
        mobilePrompt.getByRole("button", { name: "Reload" }),
      ).toBeVisible();
      await mobile.unroute("**/api/bootstrap");
      const navigation = mobile.waitForNavigation({
        waitUntil: "domcontentloaded",
      });
      await mobilePrompt.getByRole("button", { name: "Reload" }).click();
      await navigation;
      await expect(mobilePrompt).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
