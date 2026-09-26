import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "sidebar shows the latest gateway console message without widening",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 960, height: 600 },
    });
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Gateway console");
      const message = page.locator(
        ".desktop-navigation .gateway-console-message",
      );
      await expect(message).toHaveText(
        "Gateway housekeeping started and is checking scheduled jobs across every configured profile",
      );
      const layout = await message.evaluate((element) => ({
        clipped: element.scrollWidth > element.clientWidth,
        mask: globalThis.getComputedStyle(element).maskImage,
        wrapping: globalThis.getComputedStyle(element).whiteSpace,
      }));
      expect(layout.clipped).toBe(true);
      expect(layout.mask).toContain("linear-gradient");
      expect(layout.wrapping).toBe("nowrap");
      await expect(
        page.locator(".desktop-navigation .sidebar-titlebar")
          .getByRole("button", { name: "Search conversations" }),
      ).toBeVisible();
      await page.context().setOffline(true);
      await expect(message).toHaveText("Gateway disconnected", {
        timeout: 15000,
      });
    } finally {
      await browser.close();
    }
  },
});
