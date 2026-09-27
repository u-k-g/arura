import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "sources collapse and citations link across replies on mobile",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Citation links");
      await page.getByRole("button", { name: "Open conversations" }).click();
      await page.getByRole("button", {
        name: "Fixture conversation",
        exact: true,
      }).click();
      const input = page.getByLabel("Message Hermes", { exact: true });
      const send = page.getByRole("button", {
        name: "Send message",
        exact: true,
      });
      await input.fill("ARURA_TEST_SOURCES_FIRST");
      await send.click();
      const first = page.locator(".message.assistant").filter({
        hasText: "First reply.",
      }).last();
      await expect(first.getByRole("link", { name: "Source 5" }))
        .toHaveAttribute("href", "https://example.com/five");

      await input.fill("ARURA_TEST_SOURCES_SECOND");
      await send.click();
      const second = page.locator(".message.assistant").filter({
        hasText: "Second reply.",
      }).last();
      const current = second.getByRole("link", { name: "Source 1" });
      const earlier = second.getByRole("link", { name: "Source 5" });
      await expect(current).toHaveAttribute("href", "https://example.com/new");
      await expect(earlier).toHaveAttribute("href", "https://example.com/five");
      await expect(current).toHaveAttribute("target", "_blank");
      await expect(second.locator(".source-citation")).toHaveCount(2);
      await expect(second.locator("code")).toHaveText("code [1]");
      const details = second.locator(".sources-disclosure");
      await expect(details).not.toHaveAttribute("open", "");
      await expect(details).toContainText(
        "Sources [5] from the previous reply also applies.",
      );
      const overflow = await page.locator(".transcript").evaluate((element) =>
        element.scrollWidth > element.clientWidth
      );
      expect(overflow).toBe(false);
      await second.screenshot({
        path: `${Deno.env.get("TMPDIR")}/citations-mobile.png`,
      });
    } finally {
      await browser.close();
    }
  },
});
