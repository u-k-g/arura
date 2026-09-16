import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";

Deno.test({
  name:
    "anchored model picker filters providers, syncs stars and changes session reasoning",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL");
    const a = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const b = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      for (
        const [page, name] of [
          [a, "Picker desktop"],
          [b, "Picker mobile"],
        ] as const
      ) {
        await page.goto(url);
        await signIn(page, name);
        if (page === a) {
          await page
            .getByRole("button", { name: "Fixture conversation", exact: true })
            .click();
        }
        await page.getByRole("button", { name: "Model", exact: true }).click();
        await expect(
          page.getByRole("dialog", { name: "Choose a model" }),
        ).toBeVisible();
      }
      const picker = a.getByRole("dialog", { name: "Choose a model" });
      await expect(
        picker.getByRole("button", { name: "Starred models", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      let optionRequests = 0;
      a.on("request", (request) => {
        if (
          request.url().endsWith("/api/query") &&
          request.postDataJSON()?.method === "model.options"
        ) {
          optionRequests++;
        }
      });
      await a.getByRole("button", { name: "Model", exact: true }).click();
      await expect(picker).toHaveCount(0);
      expect(optionRequests).toBe(0);
      await a.getByRole("button", { name: "Model", exact: true }).click();
      await expect(picker).toBeVisible();
      await expect(
        picker.getByRole("button", { name: "Starred models", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const anchor = requireValue(
        await a
          .getByRole("button", { name: "Model", exact: true })
          .boundingBox(),
        "anchor",
      );
      const popup = requireValue(await picker.boundingBox(), "picker");
      expect(popup.y + popup.height).toBeLessThanOrEqual(anchor.y);
      expect(
        Math.abs(popup.x + popup.width - anchor.x - anchor.width),
      ).toBeLessThan(2);
      await picker
        .getByRole("button", { name: "Fixture provider", exact: true })
        .click();
      await picker
        .getByRole("searchbox", { name: "Search models" })
        .fill("alternative");
      await expect(picker.locator(".model-choice")).toHaveCount(1);
      await picker
        .getByRole("button", {
          name: "Star fixture-alternative · Fixture provider",
          exact: true,
        })
        .click();
      await expect(
        picker.getByRole("button", {
          name: "Unstar fixture-alternative · Fixture provider",
          exact: true,
        }),
      ).toBeVisible();
      const mobile = b.getByRole("dialog", { name: "Choose a model" });
      await mobile
        .getByRole("button", { name: "Starred models", exact: true })
        .click();
      await expect(mobile.locator(".model-choice")).toHaveCount(1);
      await expect(mobile.locator(".model-choice")).toContainText(
        "fixture-alternative",
      );
      const mobileBox = requireValue(
        await mobile.boundingBox(),
        "mobile popup",
      );
      expect(mobileBox.x).toBeGreaterThanOrEqual(0);
      expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(390);
      await a.screenshot({ path: "/var/tmp/arura-model-picker-desktop.png" });
      await b.screenshot({ path: "/var/tmp/arura-model-picker-mobile.png" });
      await picker
        .getByLabel("Reasoning effort", { exact: true })
        .selectOption("high");
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("high");
      await picker
        .getByRole("button", {
          name: "fixture-alternative · Fixture provider",
          exact: true,
        })
        .click();
      await expect(picker).toHaveCount(0);
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-alternative");
      await mobile
        .getByRole("button", {
          name: "Unstar fixture-alternative · Fixture provider",
          exact: true,
        })
        .click();
      await expect(mobile.locator(".model-choice")).toHaveCount(0);
      await a.getByRole("button", { name: "Model", exact: true }).click();
      await expect(picker).toBeVisible();
      await a.bringToFront();
      await a.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toBeFocused();
    } finally {
      await browser.close();
    }
  },
});
