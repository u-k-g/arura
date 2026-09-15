import { signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";
Deno.test({
  name:
    "Command Enter queues multiple messages and sends the first now only with an empty composer",
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
      await signIn(page, "Queue keyboard test");
      await page
        .locator(".topbar")
        .getByRole("button", { name: "New conversation", exact: true })
        .click();
      const input = page.getByRole("textbox", {
        name: "Message Hermes",
        exact: true,
      });
      await input.fill("ARURA_TEST_CONTROLS");
      await input.press("Meta+Enter");
      await expect(
        page.getByText("Waiting for instructions.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Steer", exact: true }),
      ).toHaveCount(0);
      await input.fill("first");
      await input.press("Enter");
      await expect(input).toContainText("first");
      await expect(page.locator(".queued-message")).toHaveCount(0);
      await input.fill("first");
      await input.press("Meta+Enter");
      await expect(page.locator(".queued-message")).toHaveCount(1);
      await expect(input).toHaveText("");
      await input.fill("second");
      await input.press("Meta+Enter");
      await expect(page.locator(".queued-message")).toHaveCount(2);
      await input.fill("third");
      await input.press("Meta+Enter");
      await expect(page.locator(".queued-message")).toHaveCount(3);
      await expect(input).toHaveText("");
      await input.press("Meta+Enter");
      await expect(page.locator(".queued-message")).toHaveCount(2);
      await expect(page.locator(".queued-message").first()).toContainText(
        "second",
      );
      await input.fill("fourth");
      await input.press("Meta+Enter");
      await expect(page.locator(".queued-message")).toHaveCount(3);
      await page
        .locator(".queued-message")
        .first()
        .getByRole("button", { name: "Send Now", exact: true })
        .click();
      await expect(page.locator(".queued-message")).toHaveCount(2);
      await page
        .locator(".queued-message")
        .first()
        .getByRole("button", { name: "Edit queued message", exact: true })
        .click();
      const edit = page.locator("dialog.action-dialog");
      await edit.getByRole("textbox").fill("third\nwith a second line");
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator(".queued-message").first()).toContainText(
        "third\nwith a second line",
      );
      expect(
        (await page.locator(".queued-message").last().boundingBox())!.height,
      ).toBeLessThanOrEqual(32);
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/queue-desktop.png`,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page
          .locator(".queued-message")
          .first()
          .getByRole("button", { name: "Send Now", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/queue-mobile.png`,
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page
        .getByRole("button", { name: "Clear All", exact: true })
        .click();
      await expect(page.locator(".queue-panel")).toHaveCount(0);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(
        page.locator(".markdown").filter({
          hasText: /Stopped\. Instructions received: first\s*; second/,
        }),
      ).toBeVisible();
    } catch (error) {
      console.error(await page.locator("body").innerText());
      throw error;
    } finally {
      await browser.close();
    }
  },
});
