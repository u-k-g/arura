import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "four icon navigation switches main content on desktop and mobile",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    try {
      for (const width of [1280, 390]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
        });
        await page.goto(
          requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"),
        );
        await signIn(page, `Sections ${width}`);
        const openNavigation = async () => {
          if (width === 390) {
            await page
              .getByRole("button", { name: "Open conversations", exact: true })
              .click();
          }
        };
        await openNavigation();
        await page
          .getByRole("button", { name: "Fixture conversation", exact: true })
          .click();
        for (
          const [label, route] of [
            ["Bots", "resources:profiles"],
            ["Artifacts", "resources:artifacts"],
            ["Cron jobs", "resources:jobs"],
            ["Threads", '["default","fixture-chat"]'],
          ]
        ) {
          await openNavigation();
          const nav = page.getByRole("navigation", {
            name: "Main navigation",
            exact: true,
          });
          await expect(nav.getByRole("button")).toHaveCount(4);
          const button = nav.getByRole("button", { name: label, exact: true });
          await expect(button).toHaveText("");
          await button.click();
          await expect
            .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
            .toBe(route);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          if (label === "Bots") {
            await expect(
              page.getByRole("heading", {
                name: "Profiles & bots",
                exact: true,
              }),
            ).toBeVisible();
          }
          if (label === "Cron jobs") {
            await expect(
              page.getByRole("heading", {
                name: "Scheduled jobs",
                exact: true,
              }),
            ).toBeVisible();
          }
          if (label === "Artifacts") {
            await expect(page.locator(".artifacts-page")).toBeVisible();
          }
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  },
});
