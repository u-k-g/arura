import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";
Deno.test({
  name:
    "bot history loads older compacted turns without duplicates or losing the reading position",
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
      await page.getByRole("button", { name: "Bot Chat", exact: true }).click();
      const transcript = page.locator(".transcript");
      await expect(
        transcript.getByText("History row 250", { exact: true }),
      ).toBeVisible();
      await expect(
        transcript.getByText("History row 150", { exact: true }),
      ).toHaveCount(0);
      const earlier = page.getByRole("button", {
        name: "Load earlier messages",
        exact: true,
      });
      await earlier.click();
      await expect(
        transcript.getByText("History row 051", { exact: true }),
      ).toHaveCount(1);
      await expect(
        transcript.getByText("History row 151", { exact: true }),
      ).toBeInViewport();
      await earlier.click();
      await expect(
        transcript.getByText("History row 001", { exact: true }),
      ).toHaveCount(1);
      await expect(earlier).toHaveCount(0);
      // Offscreen messages use content-visibility; inspect all loaded DOM text.
      const text = (await transcript.textContent()) ?? "";
      const rows = text.match(/History row \d{3}/g) ?? [];
      expect(rows).toHaveLength(250);
      expect(new Set(rows).size).toBe(250);
      expect(rows[0]).toBe("History row 001");
      expect(rows.at(-1)).toBe("History row 250");
    } finally {
      await patch({
        title: "Fixture conversation",
        messages: original.messages,
      });
      await browser.close();
    }
  },
});
