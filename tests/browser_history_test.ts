import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";
Deno.test({
  name: "bot history preloads nearby turns and opens at the latest message",
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
        messages: Array.from({ length: 450 }, (_, index) => ({
          id: 10000 + index,
          role: index % 2 ? "assistant" : "user",
          content: `History row ${String(index + 1).padStart(3, "0")}${
            index % 2 ? `\n\n${"Reading content. ".repeat(100)}` : ""
          }`,
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
        transcript.getByText("History row 450", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Load earlier messages",
        }),
      ).toHaveCount(0);
      const minimapMarks = page.locator(".turn-minimap-mark");
      const distanceFromBottom = () =>
        transcript.evaluate(
          (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
        );
      await expect.poll(distanceFromBottom).toBeLessThan(4);
      // The rail represents every turn, including pages not yet in the DOM.
      await expect(minimapMarks).toHaveCount(225);
      await expect.poll(distanceFromBottom).toBeLessThan(4);
      await expect(transcript.locator(".transcript-group")).toHaveCount(150);
      await transcript.evaluate((node) => {
        node.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        node.scrollTo(0, 0);
      });
      await expect(transcript.locator(".transcript-group")).toHaveCount(200);
      await expect(minimapMarks).toHaveCount(225);
      const rail = page.getByRole("button", { name: /Jump to a turn/ });
      await rail.press("Home");
      await rail.press("Enter");
      await expect(transcript.locator(".transcript-group")).toHaveCount(225);
      await expect(minimapMarks).toHaveCount(225);
      await expect(
        transcript.getByText("History row 001", { exact: true }),
      ).toBeVisible();
      const rowBounds = await transcript
        .locator(".transcript-group")
        .evaluateAll((rows) =>
          rows
            .map((row) => {
              const { top, bottom } = row.getBoundingClientRect();
              return { top, bottom };
            })
            .sort((left, right) => left.top - right.top)
        );
      expect(
        rowBounds
          .slice(1)
          .every((row, index) => row.top >= rowBounds[index].bottom - 1),
      ).toBe(true);
      await expect(transcript.locator(".transcript-group")).toHaveCount(225);
      await expect(transcript.locator(".transcript-group").first()).toHaveCSS(
        "content-visibility",
        "auto",
      );
      await page
        .getByRole("button", {
          name: "New conversation",
          exact: true,
        })
        .click();
      await page
        .locator(".thread-select")
        .filter({ hasText: "default" })
        .click();
      await expect.poll(distanceFromBottom).toBeLessThan(4);
      await expect(
        transcript.getByText("History row 450", { exact: true }),
      ).toBeVisible();
      await transcript.evaluate((node) => {
        node.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        node.scrollTo(0, 0);
      });
      const latest = page.getByRole("button", {
        name: "Jump to latest messages",
      });
      await latest.click();
      await expect(
        transcript.getByText("History row 450", { exact: true }),
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
