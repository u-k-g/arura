import { requireValue } from "./require_value.ts";
import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "markdown tables keep readable columns and scroll within the message",
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
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Markdown table layout");
      const input = page.getByLabel("Message Hermes", { exact: true });
      await input.fill(
        "| Part | Size | Why that |\n| --- | --- | --- |\n| Linear rail | MGN12, 500 mm rail + MGN12H block | The size every supplier stocks in 100 mm increments, with room beside it for the heat pipe and mounting hardware. |\n| Heat pipe | Flat sintered, 8 mm wide × 3 mm thick | Fits the exposed ledge beside a 12 mm rail without requiring a custom part. |",
      );
      await page.getByRole("button", { name: "Send message", exact: true })
        .click();
      const table = page.locator(".message.user .markdown table").first();
      await expect(table).toBeVisible();
      const firstCell = table.locator("td").first();
      expect(
        await firstCell.evaluate((cell) => cell.getBoundingClientRect().width),
      )
        .toBeGreaterThanOrEqual(140);
      await table.screenshot({
        path: `${Deno.env.get("TMPDIR")}/table-desktop.png`,
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await table.screenshot({
        path: `${Deno.env.get("TMPDIR")}/table-mobile.png`,
      });
      const layout = await table.evaluate((element) => {
        const cell = element.querySelector("td");
        if (!cell) throw new Error("Missing table cell");
        element.scrollLeft = element.scrollWidth;
        return {
          firstCellWidth: cell.getBoundingClientRect().width,
          scrollable: element.scrollWidth > element.clientWidth,
          scrolled: element.scrollLeft > 0,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(layout.firstCellWidth).toBeGreaterThanOrEqual(140);
      expect(layout.scrollable).toBe(true);
      expect(layout.scrolled).toBe(true);
      expect(layout.pageOverflow).toBe(false);
    } finally {
      await browser.close();
    }
  },
});
