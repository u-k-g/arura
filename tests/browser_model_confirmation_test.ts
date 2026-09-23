import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name:
    "model confirmation retries a failed send without placing the warning in history",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "App URL"));
      await signIn(page, "Model confirmation");
      await page.getByLabel("Message Hermes").fill("ARURA_TEST_MODEL_CONFIRM");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText("Received: ARURA_TEST_MODEL_CONFIRM", {
        exact: true,
      })).toBeVisible();
      const conversation = requireValue(
        await page.evaluate(() => localStorage.getItem("arura.view")),
        "conversation key",
      );
      const auth = await (await page.request.get(
        `${Deno.env.get("ARURA_TEST_URL")}/auth/token`,
      )).json();
      const client = new ConvexHttpClient(
        requireValue(Deno.env.get("CONVEX_SELF_HOSTED_URL"), "Convex URL"),
      );
      client.setAuth(auth.token);
      await client.mutation(anyApi.commands.enqueue, {
        id: crypto.randomUUID(),
        conversation,
        kind: "send",
        payload: {
          text: "Confirm this model switch",
          model: {
            value: "fixture-alternative --provider fixture --session",
            label: "fixture-alternative",
            provider: "fixture",
            confirmed: false,
          },
        },
      });
      const issue = page.locator(".compose-area .command-error");
      await expect(issue).toContainText("Model switch needs confirmation");
      await expect(page.locator(".transcript .command-error")).toHaveCount(0);
      await expect(
        page.locator("article.user").filter({
          hasText: "Confirm this model switch",
        }),
      ).toHaveCount(0);
      await issue.getByRole("button", {
        name: "Confirm switch and send",
      }).click();
      const dialog = page.getByRole("dialog", {
        name: "Switch model and send?",
      });
      await expect(dialog).toContainText("LARGE CONTEXT MODEL SWITCH");
      await dialog.getByRole("button", { name: "Switch and send" }).click();
      await expect(page.getByText("Received: Confirm this model switch", {
        exact: true,
      })).toBeVisible();
      await expect(
        page.locator("article.user").filter({
          hasText: "Confirm this model switch",
        }),
      ).toHaveCount(1);
      await expect(issue).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
