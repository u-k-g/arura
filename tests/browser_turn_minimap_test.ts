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
        if (index === 1) {
          await expect(page.getByRole("button", {
            name: "Jump to latest messages",
          })).toHaveCount(0);
        }
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
      await expect(page.locator(".turn-minimap-mark.current")).toBeVisible();
      const currentMarkBox = requireValue(
        await page.locator(".turn-minimap-mark.current").boundingBox(),
        "current mark bounds",
      );
      expect(spineBox.x + spineBox.width).toBeLessThan(currentMarkBox.x);
      expect(currentMarkBox.x - (spineBox.x + spineBox.width))
        .toBeLessThan(6);
      const idleWidths = await page.locator(".turn-minimap-mark").evaluateAll(
        (marks) => marks.map((mark) => mark.getBoundingClientRect().width),
      );
      expect(new Set(idleWidths).size).toBe(1);
      const firstMark = page.locator(".turn-minimap-mark").first();
      await expect(firstMark).toBeVisible();
      const firstIdleBox = requireValue(
        await firstMark.boundingBox(),
        "first idle mark bounds",
      );
      const tickPositions = await page.locator(".turn-minimap-mark")
        .evaluateAll((marks) =>
          marks.map((mark) => mark.getBoundingClientRect().top)
        );
      expect(
        tickPositions.slice(1).every((top, index) =>
          Math.abs(top - tickPositions[index] - 9) < 0.1
        ),
      ).toBe(true);
      expect(
        await spine.evaluate((element) => getComputedStyle(element).opacity),
      )
        .toBe("0.09");
      const scrollTop = () => transcript.evaluate((node) => node.scrollTop);
      const before = await scrollTop();
      expect(before).toBeGreaterThan(0);
      await rail.hover({ position: { x: 24, y: 1 } });
      await expect(page.locator(".turn-minimap-preview"))
        .toContainText("Rail turn 1");
      await expect.poll(() =>
        firstMark.evaluate((mark) => mark.getBoundingClientRect().width)
      ).toBe(30);
      const firstHoverBox = requireValue(
        await firstMark.boundingBox(),
        "first hovered mark bounds",
      );
      expect(firstHoverBox.x).toBeLessThan(firstIdleBox.x);
      expect(firstHoverBox.x + firstHoverBox.width).toBeCloseTo(
        firstIdleBox.x + firstIdleBox.width,
      );
      await expect(page.locator(".turn-minimap-mark.current"))
        .toHaveCSS("width", "10px");
      await expect(page.locator(".turn-minimap-mark.nearby"))
        .toHaveCSS("width", "17px");
      await rail.click({ position: { x: 24, y: 1 } });
      await expect.poll(scrollTop).toBeLessThan(before);
      await expect(rail).toHaveAttribute("aria-label", /Current turn 1 of 4/);
      await expect(page.getByRole("button", { name: "Previous turn" }))
        .toHaveCount(0);
      await expect(page.locator(".jump-to-latest")).toHaveCount(0);
      const latest = page.getByRole("button", {
        name: "Jump to latest messages",
      });
      await expect(latest).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(firstMark).toHaveCSS("width", "10px");
      const tickBox = requireValue(
        await firstMark.boundingBox(),
        "tick bounds",
      );
      const arrowBox = requireValue(
        await latest.locator(".icon").boundingBox(),
        "jump arrow bounds",
      );
      expect(
        Math.abs(
          tickBox.x + tickBox.width / 2 -
            (arrowBox.x + arrowBox.width / 2),
        ),
      ).toBeLessThan(0.5);
      await latest.click();
      await expect.poll(() =>
        transcript.evaluate((node) =>
          node.scrollHeight - node.scrollTop - node.clientHeight
        )
      ).toBeLessThanOrEqual(1);
      await expect(latest).toHaveCount(0);
      await expect(page.locator(".turn-minimap-step")).toBeHidden();
      await transcript.evaluate((node) => node.scrollTo(0, 0));
      await expect(latest).toBeVisible();
      await transcript.evaluate((node) => node.scrollTo(0, node.scrollHeight));
      await expect(latest).toHaveCount(0);
      await rail.focus();
      await rail.press("End");
      await rail.press("Enter");
      await expect.poll(scrollTop).toBeGreaterThan(0);
      await page.screenshot({ path: "/var/tmp/arura-turn-minimap.png" });
      for (let index = 5; index <= 9; index++) {
        await input.fill(`Rail turn ${index}`);
        await page.getByRole("button", { name: "Send message" }).click();
        await expect(page.getByText(`Received: Rail turn ${index}`, {
          exact: true,
        })).toBeVisible();
      }
      await page.setViewportSize({ width: 1440, height: 320 });
      const viewport = page.locator(".turn-minimap-viewport");
      await expect.poll(() =>
        viewport.evaluate((node) => node.scrollHeight > node.clientHeight)
      ).toBe(true);
      const positions = await page.locator(".turn-minimap-mark")
        .evaluateAll((marks) =>
          marks.map((mark) => mark.getBoundingClientRect().top)
        );
      expect(
        positions.slice(1).every((top, index) =>
          Math.abs(top - positions[index] - 9) < 0.1
        ),
      ).toBe(true);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("navigation", {
        name: "Conversation turns",
      })).toBeHidden();
    } finally {
      await browser.close();
    }
  },
});
