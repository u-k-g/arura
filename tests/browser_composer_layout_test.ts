import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name:
    "composer gives wrapped text the full row and keeps controls on the right",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL");
    try {
      const page = await browser.newPage({
        viewport: { width: 960, height: 600 },
      });
      await page.goto(url);
      await signIn(page, "Composer layout");
      const form = page.locator(".composer");
      const input = page.getByRole("textbox", { name: "Message Hermes" });
      const model = form.getByRole("button", { name: "Model" });
      await expect(model.locator(".icon")).toHaveCount(0);
      await expect(form).not.toHaveClass(/stacked/);
      const narrowWidth = await input.evaluate((element) =>
        element.getBoundingClientRect().width
      );
      await input.fill("x".repeat(100));
      await expect(form).toHaveClass(/stacked/);
      const wideWidth = await input.evaluate((element) =>
        element.getBoundingClientRect().width
      );
      expect(wideWidth).toBeGreaterThan(narrowWidth + 100);
      expect(await input.evaluate((element) => element.scrollHeight))
        .toBeLessThan(40);
      const positions = await form.evaluate((element) => {
        const input = element.querySelector(".composer-input")!;
        const controls = element.querySelector(".composer-bottom")!;
        const attachment = element.querySelector(".composer-add")!;
        const model = element.querySelector(".composer-model")!;
        return {
          inputBottom: input.getBoundingClientRect().bottom,
          controlsTop: controls.getBoundingClientRect().top,
          attachmentX: attachment.getBoundingClientRect().x,
          modelX: model.getBoundingClientRect().x,
        };
      });
      expect(positions.controlsTop).toBeGreaterThanOrEqual(
        positions.inputBottom,
      );
      expect(positions.attachmentX).toBeGreaterThan(positions.modelX);
      await input.fill("");
      await expect(form).not.toHaveClass(/stacked/);

      const mobile = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await mobile.goto(url);
      await signIn(mobile, "Composer mobile layout");
      const mobileForm = mobile.locator(".composer");
      await expect(mobileForm.getByRole("button", { name: "Add context" }))
        .toBeVisible();
      const overflow = await mobileForm.evaluate((element) => {
        const controls = element.querySelector(".composer-bottom")!;
        return controls.scrollWidth - controls.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(1);
      const mobilePositions = await mobileForm.evaluate((element) => ({
        attachment: element.querySelector(".composer-add")!
          .getBoundingClientRect().x,
        model: element.querySelector(".composer-model")!
          .getBoundingClientRect().x,
      }));
      expect(mobilePositions.attachment).toBeGreaterThan(
        mobilePositions.model,
      );
    } finally {
      await browser.close();
    }
  },
});
