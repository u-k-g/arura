import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "interim sentence is never doubled when Hermes streams it again",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Interim stream");
      await page
        .getByRole("button", {
          name: "Fixture conversation",
          exact: true,
        })
        .click();
      await page
        .getByRole("textbox", { name: "Message Hermes" })
        .fill("ARURA_TEST_INTERIM_DUPLICATE");
      await page.getByRole("button", { name: "Send message" }).click();
      const phrase = "Let me zoom into the photo first.";
      await expect(page.locator(".live-message .markdown")).toContainText(
        phrase,
      );
      await expect(page.locator(".transcript-inner")).toContainText(
        "The fade starts higher",
      );
      const occurrences = () =>
        page
          .locator(".transcript-inner")
          .evaluate(
            (element, text) =>
              (element as HTMLElement).innerText.split(text).length - 1,
            phrase,
          );
      expect(await occurrences()).toBe(1);
      await expect(
        page
          .locator(".transcript-group")
          .last()
          .locator(".message.assistant .markdown"),
      ).toContainText("The fade starts higher near the temple.");
      await expect.poll(occurrences).toBe(1);
    } finally {
      await browser.close();
    }
  },
});
