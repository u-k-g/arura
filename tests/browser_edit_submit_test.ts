import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "rapid keyboard edit submission asks once and sends once",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Edit submission race");
      await page
        .getByRole("button", {
          name: "Fixture conversation",
          exact: true,
        })
        .click();
      const input = page.getByRole("textbox", { name: "Message Hermes" });
      await input.fill("Original instruction");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(
        page.getByText("Received: Original instruction", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .locator(".message.user")
        .filter({ hasText: "Original instruction" })
        .getByRole("button", { name: "Edit and resubmit" })
        .click();
      await input.fill("Revised instruction");
      await input.evaluate((element) => {
        for (let index = 0; index < 2; index++) {
          element.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              metaKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      });
      const dialog = page.getByRole("dialog", {
        name: "Replace the conversation after this message? Files and external actions will not be undone.",
      });
      await expect(dialog).toHaveCount(1);
      await dialog
        .getByRole("button", { name: "Confirm", exact: true })
        .click();
      await expect(
        page.getByText("Received: Revised instruction", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .locator(".message.user")
          .filter({ hasText: "Revised instruction" }),
      ).toHaveCount(1);
      await expect(
        page.getByText("Received: Original instruction", {
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
