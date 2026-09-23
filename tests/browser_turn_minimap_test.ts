import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "right-side turn minimap previews and navigates conversation turns",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 480 },
    });
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Turn minimap");
      await page.getByRole("button", {
        name: "Fixture conversation",
        exact: true,
      }).click();
      const input = page.getByLabel("Message Hermes", { exact: true });
      for (let index = 1; index <= 4; index++) {
        await input.fill(`Rail turn ${index}`);
        await page.getByRole("button", { name: "Send message" }).click();
        await expect(page.getByText(`Received: Rail turn ${index}`, {
          exact: true,
        })).toBeVisible();
      }
      const rail = page.getByRole("button", { name: /Jump to a turn/ });
      await expect(rail).toBeVisible();
      const transcript = page.getByRole("region", {
        name: "Conversation history",
      });
      const railBox = requireValue(await rail.boundingBox(), "rail bounds");
      const transcriptBox = requireValue(
        await transcript.boundingBox(),
        "transcript bounds",
      );
      expect(railBox.x).toBeGreaterThan(
        transcriptBox.x + transcriptBox.width * 0.75,
      );
      const spine = page.locator(".turn-minimap-spine");
      const spineBox = requireValue(await spine.boundingBox(), "spine bounds");
      const currentMarkBox = requireValue(
        await page.locator(".turn-minimap-mark.current").boundingBox(),
        "current mark bounds",
      );
      expect(spineBox.x + spineBox.width).toBeLessThan(currentMarkBox.x);
      expect(
        await spine.evaluate((element) => getComputedStyle(element).opacity),
      )
        .toBe("0.25");
      const scrollTop = () => transcript.evaluate((node) => node.scrollTop);
      const before = await scrollTop();
      expect(before).toBeGreaterThan(0);
      await rail.hover({ position: { x: 24, y: 1 } });
      await expect(page.locator(".turn-minimap-preview"))
        .toContainText("Rail turn 1");
      await rail.click({ position: { x: 24, y: 1 } });
      await expect.poll(scrollTop).toBeLessThan(before);
      await expect(rail).toHaveAttribute("aria-label", /Current turn 1 of 4/);
      await rail.focus();
      await rail.press("End");
      await rail.press("Enter");
      await expect.poll(scrollTop).toBeGreaterThan(0);
      await page.screenshot({ path: "/var/tmp/arura-turn-minimap.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("navigation", {
        name: "Conversation turns",
      })).toBeHidden();
    } finally {
      await browser.close();
    }
  },
});
