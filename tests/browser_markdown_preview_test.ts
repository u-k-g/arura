import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "Hermes math and inline HTML previews render without raw directives",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Markdown preview");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("ARURA_TEST_MATH_PREVIEW");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();

      const answer = page
        .locator(".message.assistant")
        .filter({
          has: page.locator(".inline-preview"),
        })
        .last();
      await expect(answer.locator("math")).toBeVisible();
      await expect(answer).not.toContainText("::preview");
      const preview = answer.locator(".inline-preview").first();
      await expect(
        preview.getByText("Preview · inline-preview.html"),
      ).toBeVisible();
      const frame = preview.locator("iframe");
      await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
      await expect(
        frame.contentFrame().getByRole("heading", {
          name: "Fixture diagram",
        }),
      ).toBeVisible();
      await expect(frame.contentFrame().locator("body")).toHaveAttribute(
        "data-ready",
        "yes",
      );
      await expect(
        preview.getByRole("link", { name: "Download HTML" }),
      ).toHaveAttribute("href", /\/api\/download\?path=/);
      await expect(answer.locator(".inline-preview").last()).toContainText(
        "Preview file is unavailable.",
      );
    } finally {
      await browser.close();
    }
  },
});
