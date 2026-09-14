import { chromium, expect } from "@playwright/test";

Deno.test({
  name: "navigation rail, command palette and adaptive conversation menus",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await page.goto(Deno.env.get("ARURA_TEST_URL")!);
      await page
        .getByLabel("Device name", { exact: true })
        .fill("Navigation review");
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Recent conversations",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Collapse sidebar", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Expand sidebar", exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Expand sidebar", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Control+k");
      const search = page.getByRole("combobox", {
        name: "Search conversations and actions",
        exact: true,
      });
      await search.fill("settings");
      await expect(
        page.getByRole("option", { name: "Settings", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await search.press("Enter");
      await expect(
        page.getByRole("button", { name: "Access & devices", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Expand sidebar", exact: true })
        .click();
      const conversation = page.getByRole("button", {
        name: "Fixture conversation",
        exact: true,
      });
      await conversation.click();
      await page
        .getByRole("button", { name: "Toggle conversation pin", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Toggle conversation pin",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await conversation.click({ button: "right" });
      const menu = page.getByRole("dialog", {
        name: "Fixture conversation",
        exact: true,
      });
      await expect(menu).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds!.width).toBeLessThan(320);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
      await page.keyboard.press("End");
      await expect(
        menu.getByRole("button", { name: "Delete conversation", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Conversation actions", exact: true })
        .click();
      await expect(menu).toBeVisible();
      const mobile = await menu.boundingBox();
      expect(mobile!.x).toBe(0);
      expect(Math.round(mobile!.y + mobile!.height)).toBe(844);
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/chrome-mobile-menu.png`,
      });
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Conversations", exact: true }),
      ).toBeVisible();
    } finally {
      await browser.close();
    }
  },
});
