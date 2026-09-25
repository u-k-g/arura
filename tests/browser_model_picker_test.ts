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
      let baselineTitle = "";
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
          await page.locator(".nav-footer").getByRole("button", {
            name: "New conversation",
          }).click();
          await page.getByLabel("Message Hermes", { exact: true })
            .fill("Model baseline conversation");
          await page.getByRole("button", { name: "Send message", exact: true })
            .click();
          await expect(page.getByText(
            "Received: Model baseline conversation",
            { exact: true },
          )).toBeVisible();
          baselineTitle = requireValue(
            await page.locator(".thread-row.selected .thread-select")
              .getAttribute("aria-label"),
            "baseline conversation title",
          );
          await page.getByRole("button", {
            name: "Fixture conversation",
            exact: true,
          }).click();
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
      await expect(
        picker
          .getByRole("combobox", { name: "Reasoning effort" })
          .locator("option:not([disabled])"),
      ).toHaveText(["Low", "High"]);
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
      await expect(
        b.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-alternative");
      await a.getByRole("button", { name: "Model", exact: true }).click();
      await picker.getByRole("combobox", { name: "Reasoning effort" })
        .selectOption("low");
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("low");
      await picker.getByRole("button", {
        name: "Fixture provider",
        exact: true,
      }).click();
      await picker.getByRole("button", {
        name: "fixture-model · Fixture provider",
        exact: true,
      }).click();
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-model · high");
      await a.getByRole("button", { name: "Model", exact: true }).click();
      await picker.getByRole("button", {
        name: "fixture-alternative · Fixture provider",
        exact: true,
      }).click();
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-alternative · low");
      await expect(
        mobile.getByRole("combobox", { name: "Reasoning effort" }),
      ).toHaveValue("low");
      await a
        .locator(".sidebar-titlebar, .topbar, .nav-footer, .pinned-divider")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-alternative");
      await a
        .getByLabel("Message Hermes", { exact: true })
        .fill("Use my selected model");
      await a
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        a.getByText("Received: Use my selected model", { exact: true }),
      ).toBeVisible();
      const conversation = await a.evaluate(() =>
        localStorage.getItem("arura.view")
      );
      const runtime = await a.request.post(`${url}/api/query`, {
        headers: { Origin: url },
        data: { method: "session.context_breakdown", conversation },
      });
      expect(runtime.ok()).toBe(true);
      expect((await runtime.json()).model).toBe("fixture-alternative");
      const effortAfterSend = await a.request.post(`${url}/api/query`, {
        headers: { Origin: url },
        data: {
          method: "config.get",
          conversation,
          params: { key: "reasoning" },
        },
      });
      expect(effortAfterSend.ok()).toBe(true);
      expect((await effortAfterSend.json()).value).toBe("low");
      await a.reload();
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-alternative");
      await a
        .getByRole("button", { name: baselineTitle, exact: true })
        .click();
      await expect(
        a.getByRole("button", { name: "Model", exact: true }),
      ).toContainText("fixture-alternative");
      await a.getByLabel("Message Hermes", { exact: true })
        .fill("Keep the shared model in this chat");
      await a.getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        a.getByText("Received: Keep the shared model in this chat", {
          exact: true,
        }),
      ).toBeVisible();
      const reusedConversation = await a.evaluate(() =>
        localStorage.getItem("arura.view")
      );
      const reusedRuntime = await a.request.post(`${url}/api/query`, {
        headers: { Origin: url },
        data: {
          method: "session.context_breakdown",
          conversation: reusedConversation,
        },
      });
      expect(reusedRuntime.ok()).toBe(true);
      expect((await reusedRuntime.json()).model).toBe("fixture-alternative");
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
Deno.test({
  name: "composer omits effort for models without reported reasoning levels",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Unreported effort");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      const button = page.getByRole("button", { name: "Model", exact: true });
      await button.click();
      const picker = page.getByRole("dialog", { name: "Choose a model" });
      await picker.getByRole("combobox", { name: "Reasoning effort" })
        .selectOption("high");
      await expect(button).toContainText("high");
      await picker.getByRole("button", {
        name: "Fixture provider",
        exact: true,
      }).click();
      await picker.getByRole("button", {
        name: "fixture-unreported · Fixture provider",
        exact: true,
      }).click();
      await expect(picker).toHaveCount(0);
      await expect(button).toContainText("fixture-unreported");
      await expect(button).not.toContainText(/high|Off|Not reported/);
      await button.click();
      const effort = picker.getByRole("combobox", { name: "Reasoning effort" });
      await expect(effort).toBeDisabled();
      await expect(effort.locator("option:checked"))
        .toHaveText("Not reported");
      await page.reload();
      await expect(button).toContainText("fixture-unreported");
      await expect(button).not.toContainText(/high|Off|Not reported/);
    } finally {
      await browser.close();
    }
  },
});
