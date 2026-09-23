import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";
Deno.test({
  name:
    "bot history loads earlier turns on scroll with a bounded transcript DOM",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const source = `${Deno.env.get("HERMES_URL")}/api/sessions/fixture-chat`;
    const original = await (await fetch(`${source}/messages?limit=500`)).json();
    const patch = async (body: unknown) => {
      const response = await fetch(source, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.ok).toBe(true);
    };
    try {
      await patch({
        title: "Bot Chat",
        messages: Array.from({ length: 250 }, (_, index) => ({
          id: 10000 + index,
          role: index % 2 ? "assistant" : "user",
          content: `History row ${String(index + 1).padStart(3, "0")}`,
          compacted: index < 150,
        })),
      });
      await page.goto(
        requireValue(
          Deno.env.get("ARURA_TEST_URL"),
          'Deno.env.get("ARURA_TEST_URL")',
        ),
      );
      await signIn(page, "History test");
      await page
        .locator(".thread-select")
        .filter({ hasText: "default" })
        .click();
      const transcript = page.locator(".transcript");
      await expect(
        transcript.getByText("History row 250", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", {
        name: "Load earlier messages",
      })).toHaveCount(0);
      const minimapMarks = page.locator(".turn-minimap-mark");
      await expect(minimapMarks).toHaveCount(50);
      for (const count of [100, 125]) {
        await transcript.evaluate((node) => node.scrollTo(0, 0));
        await expect(minimapMarks).toHaveCount(count);
      }
      await transcript.evaluate((node) => node.scrollTo(0, 0));
      await expect(
        transcript.getByText("History row 001", { exact: true }),
      ).toBeVisible();
      expect(await transcript.locator(".virtualized-group").count())
        .toBeLessThan(25);
      const latest = page.getByRole("button", {
        name: "Jump to latest messages",
      });
      await latest.click();
      await expect(
        transcript.getByText("History row 250", { exact: true }),
      ).toBeVisible();
    } finally {
      await patch({
        title: "Fixture conversation",
        messages: original.messages,
      });
      await browser.close();
    }
  },
});
