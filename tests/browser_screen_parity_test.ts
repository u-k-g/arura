import { requireValue } from "./require_value.ts";
import { chromium, expect } from "@playwright/test";
import { openSettings, signIn } from "./sign_in.ts";
Deno.test({
  name:
    "empty chat submits once, settings retain navigation, and tables have horizontal rules",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    try {
      await page.goto(
        requireValue(
          Deno.env.get("ARURA_TEST_URL"),
          'Deno.env.get("ARURA_TEST_URL")',
        ),
      );
      await signIn(page, "Screen comparison");
      await expect(
        page.getByRole("heading", { name: "HERMES AGENT" }),
      ).toBeVisible();
      const input = page.getByLabel("Message Hermes", { exact: true });
      await input.fill(
        "First message from the empty chat\n\n| Reading | Change |\n| --- | ---: |\n| X depth | −25 cm |",
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(page.locator(".message.user")).toContainText(
        "First message from the empty chat",
      );
      await expect(input).toHaveText("");
      await openSettings(page);
      await page
        .getByRole("button", { name: "Capabilities", exact: true })
        .click();
      await expect(
        page.getByRole("navigation", { name: "Settings sections" }),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Capabilities", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".resource-document")).toContainText(
        "Gardening",
      );
      await page
        .getByRole("switch", { name: "Disable gardening", exact: true })
        .click();
      await expect(
        page.getByRole("switch", { name: "Enable gardening", exact: true }),
      ).not.toBeChecked();
      await page
        .getByRole("switch", { name: "Enable gardening", exact: true })
        .click();
      await expect(
        page.getByRole("switch", { name: "Disable gardening", exact: true }),
      ).toBeChecked();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Settings sections", exact: true })
        .click();
      const sheet = page.getByRole("dialog", {
        name: "Settings sections",
        exact: true,
      });
      await sheet
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Appearance", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/settings-mobile.png`,
      });
      await page
        .getByRole("dialog", { name: "Settings", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
      const styles = await page
        .locator(".markdown table")
        .first()
        .evaluate((table) => {
          const cell = table.querySelector("td"),
            numeric = table.querySelector("td[align]");
          if (!cell || !numeric) throw new Error("Missing table cells");
          return {
            outer: getComputedStyle(table).borderTopWidth,
            vertical: getComputedStyle(cell).borderRightWidth,
            horizontal: getComputedStyle(cell).borderBottomWidth,
            align: getComputedStyle(numeric).textAlign,
          };
        });
      expect(styles).toEqual({
        outer: "0px",
        vertical: "0px",
        horizontal: "1px",
        align: "right",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => localStorage.setItem("arura.view", ""));
      await page.reload();
      await input.fill("Preserve this draft while selecting a model");
      await page.getByRole("button", { name: "Model", exact: true }).click();
      await page.getByRole("button", { name: /fixture-alternative/ }).click();
      await expect(input).toHaveText(
        "Preserve this draft while selecting a model",
      );
      await expect(
        page.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-alternative");
    } catch (error) {
      await page.screenshot({
        path: "/var/tmp/arura-screen-parity-failure.png",
      });
      await Deno.writeTextFile(
        "/var/tmp/arura-screen-parity-failure.html",
        await page.content(),
      );
      throw error;
    } finally {
      await browser.close();
    }
  },
});
