import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";
Deno.test({
  name:
    "work summary sits between its prompt and answer without duplicate tool rows",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Work layout");
      await expect(page.getByPlaceholder("Search sessions…")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Work layout check");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const answer = page
        .locator(".markdown")
        .filter({ hasText: "Received: Work layout check" });
      await expect(answer).toBeVisible();
      const summary = page.locator(".history-work").last();
      await expect(summary).toBeVisible();
      await expect(summary.locator(".past-tool")).toHaveCount(0);
      const response = answer.locator("xpath=ancestor::article");
      const statsButton = response.getByRole("button", {
        name: "Output stats",
      });
      expect(
        await response.locator(".message-actions").evaluate(
          (element) => globalThis.getComputedStyle(element).opacity,
        ),
      ).toBe("0");
      await answer.hover();
      expect(
        await response.locator(".message-actions").evaluate(
          (element) => globalThis.getComputedStyle(element).opacity,
        ),
      ).toBe("1");
      await statsButton.click();
      const stats = page.getByRole("dialog", { name: "Output stats" });
      await expect(stats).toBeVisible();
      await expect(stats).not.toContainText("Time to first output");
      await expect(stats).toContainText("Timeline");
      await expect(stats.locator(".output-stats-heading"))
        .toContainText(/\d+\.\d tps/);
      await expect(stats.locator(".output-stats-heading"))
        .not.toContainText("fixture-model");
      await expect(stats.locator(".output-stats-note"))
        .toContainText("fixture-model");
      await expect(stats.locator(".output-stats-note"))
        .not.toContainText("tps");
      await expect(stats).not.toContainText("LLM includes processing");
      await page.screenshot({ path: "/var/tmp/arura-output-stats-layout.png" });
      await stats.getByRole("button", { name: "Close" }).click();
      await page.mouse.move(0, 0);
      expect(
        await response.locator(".message-actions").evaluate(
          (element) => globalThis.getComputedStyle(element).opacity,
        ),
      ).toBe("0");
      expect(
        requireValue(await summary.boundingBox(), "summary bounds").y,
      ).toBeLessThan(
        requireValue(await answer.boundingBox(), "answer bounds").y,
      );
      await summary.locator(":scope > summary").click();
      await expect(summary.locator(".past-tool")).toHaveCount(1);
      await summary.locator(".past-tool > summary").click();
      await expect(summary.locator(".tool-payload pre")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Inspect result", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".live-message .work-summary")).toHaveCount(0);
      await summary.locator(":scope > summary").click();
      await expect(summary.locator(".past-tool")).toHaveCount(0);
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Follow-up work");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: Follow-up work" }),
      ).toBeVisible();
      const earlier = page.locator(".transcript-group").filter({
        has: page.locator(".message.user").filter({
          hasText: "Work layout check",
        }),
      });
      await earlier.getByRole("button", { name: "Output stats" }).click();
      await expect(stats).toContainText("LLM");
      await expect(stats).toContainText("Tools ×1");
      await expect(stats).not.toContainText("Read notes started");
      await stats.getByRole("button", { name: "Close" }).click();
      await page.screenshot({ path: "/var/tmp/arura-work-layout.png" });
      await page
        .getByRole("button", { name: "Cron jobs", exact: true })
        .click();
      await expect(page.getByLabel("Configuring profile")).toHaveCount(0);
      await expect(page.getByLabel("Filter schedules")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Scheduled jobs", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add schedule", exact: true }),
      ).toHaveCount(1);
      await page.screenshot({ path: "/var/tmp/arura-cron-layout.png" });
    } finally {
      await browser.close();
    }
  },
});
