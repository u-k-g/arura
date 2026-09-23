import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";

Deno.test({
  name:
    "mobile navigation follows a touch drag, snaps back, and dismisses from its header",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const url = Deno.env.get("ARURA_TEST_URL");
      if (!url) throw new Error("Missing test URL");
      await page.goto(url);
      await signIn(page, "Sheet gestures");
      const sheet = page.getByRole("dialog", {
        name: "Conversations",
        exact: true,
      });
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await expect(
        sheet.getByRole("heading", { name: "Conversations", exact: true }),
      ).toBeVisible();
      const client = await page.context().newCDPSession(page);
      await expect(
        sheet.locator(".thread-row > .icon-button:visible"),
      ).toHaveCount(0);
      const thread = sheet.getByRole("button", {
        name: "Fixture conversation",
        exact: true,
      });
      await thread.scrollIntoViewIfNeeded();
      const bounds = await thread.boundingBox();
      if (!bounds) throw new Error("Missing fixture conversation");
      const pressX = bounds.x + bounds.width / 2;
      const pressY = bounds.y + bounds.height / 2;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: pressX, y: pressY }],
      });
      await page.waitForTimeout(600);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(page.getByRole("dialog", {
        name: "Fixture conversation",
      })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeVisible();
      const drag = async (distance: number, cancel = false) => {
        const handle = await sheet.locator(".sheet-handle").boundingBox();
        if (!handle) throw new Error("Missing sheet handle");
        const x = handle.x + handle.width / 2,
          y = handle.y + handle.height / 2;
        await client.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + distance }],
        });
        await expect
          .poll(() => sheet.evaluate((el) => getComputedStyle(el).transform))
          .not.toBe("none");
        await client.send("Input.dispatchTouchEvent", {
          type: cancel ? "touchCancel" : "touchEnd",
          touchPoints: [],
        });
      };
      await drag(18);
      await expect(sheet).toBeVisible();
      await expect
        .poll(() => sheet.evaluate((el) => getComputedStyle(el).transform))
        .toBe("none");
      const list = await sheet.locator(".navigation").boundingBox();
      if (!list) throw new Error("Missing conversation list");
      const x = list.x + list.width / 2,
        y = list.y + list.height * 0.7;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - 100 }],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(sheet).toBeVisible();
      await expect
        .poll(() => sheet.evaluate((el) => getComputedStyle(el).transform))
        .toBe("none");
      await drag(140, true);
      await expect
        .poll(() => sheet.evaluate((el) => getComputedStyle(el).transform))
        .toBe("none");
      await expect(sheet).toBeVisible();
      await page.screenshot({ path: "/var/tmp/arura-mobile-sheet.png" });
      await drag(150);
      await expect(sheet).toHaveCount(0);
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Close sheet", exact: true })
        .click();
      await expect(sheet).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
