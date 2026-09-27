import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "saved answer replaces its live projection when Hermes text differs",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "History handoff");
      await page.getByRole("button", {
        name: "Fixture conversation",
        exact: true,
      }).click();
      await page.getByRole("textbox", { name: "Message Hermes" })
        .fill("ARURA_TEST_HISTORY_HANDOFF");
      await page.getByRole("button", { name: "Send message" }).click();
      const transcript = page.getByRole("region", {
        name: "Conversation history",
      });
      await expect(transcript.getByText("Saved answer appears once."))
        .toHaveCount(1);
      await expect(transcript.getByText("Different live text")).toHaveCount(0);
      await expect(transcript.locator(".live-message:visible")).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
