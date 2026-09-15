import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";
import { onceActionDialog } from "./action_dialog.ts";

Deno.test({
  name: "messaging matches Hermes platform navigation and keeps credential and access actions scoped",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    try {
      await page.goto(Deno.env.get("ARURA_TEST_URL")!);
      await signIn(page, "Messaging test");
      await page
        .getByRole("button", { name: "Messaging", exact: true })
        .click();
      const rail = page.getByRole("navigation", {
        name: "Messaging platforms",
      });
      await expect(
        rail.getByRole("button", { name: "Discord", exact: true }),
      ).toBeVisible();
      expect(
        await rail
          .locator("img")
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src"))),
      ).toEqual(["/platforms/telegram.svg", "/platforms/discord.svg"]);
      await expect(
        page.getByRole("heading", { name: "Telegram", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Configure", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("Bot token", { exact: true }),
      ).toHaveAttribute("placeholder", "Saved — leave blank to keep");
      await page.getByRole("switch", { name: "Enable Telegram" }).check();
      await expect(
        page.getByRole("switch", { name: "Disable Telegram" }),
      ).toBeChecked();
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Approved users" }),
      ).toBeVisible();
      await page
        .getByLabel("Bot token", { exact: true })
        .fill("replacement-token");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(page.getByLabel("Bot token", { exact: true })).toHaveValue(
        "",
      );
      void onceActionDialog(page, (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "Remove saved Bot token" })
        .click();
      await expect(
        page.getByLabel("Bot token", { exact: true }),
      ).toHaveAttribute("placeholder", "");
      await page.screenshot({
        path: `${Deno.env.get("ARURA_TEST_ARTIFACTS") ?? "/var/tmp"}/messaging-desktop.png`,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: /Choose platform/ }).click();
      await rail.getByRole("button", { name: "Discord", exact: true }).click();
      await expect(rail).toBeHidden();
      await expect(
        page.getByRole("heading", { name: "Discord", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: `${Deno.env.get("ARURA_TEST_ARTIFACTS") ?? "/var/tmp"}/messaging-mobile.png`,
      });
    } catch (error) {
      await page.screenshot({ path: "/var/tmp/messaging-failure.png" });
      console.log(await page.locator(".main-view").innerText());
      throw error;
    } finally {
      await browser.close();
    }
  },
});
