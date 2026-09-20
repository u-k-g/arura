import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { identity } from "../server/identity.ts";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";
Deno.test({
  name: "dismissed turn errors stay hidden after reload while new errors remain visible",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const adapter = new ConvexHttpClient(
      requireValue(Deno.env.get("CONVEX_SELF_HOSTED_URL"), "Convex URL"),
    );
    adapter.setAuth(await (await identity()).sign("arura:adapter"));
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Dismiss errors");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Prepare dismissal test");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(page.locator(".history-work")).toBeVisible();
      const publish = (startedAt: number) =>
        adapter.mutation(anyApi.workspace.ingest, {
          turn: {
            conversation: '["default","fixture-chat"]',
            startedAt,
            finishedAt: startedAt + 10,
            state: "error",
            text: "",
            error: "Named profile home does not exist",
            activity: [],
            interactions: [],
          },
        });
      await publish(1000);
      await expect(page.getByRole("alert")).toContainText(
        "Named profile home does not exist",
      );
      await page
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      await publish(1000);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await publish(2000);
      await expect(page.getByRole("alert")).toContainText(
        "Named profile home does not exist",
      );
      await page
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
      const base = requireValue(Deno.env.get("ARURA_TEST_URL"), "URL");
      const auth = await (await page.request.get(`${base}/auth/token`)).json();
      const client = new ConvexHttpClient(
        requireValue(Deno.env.get("CONVEX_SELF_HOSTED_URL"), "Convex URL"),
      );
      client.setAuth(auth.token);
      await client.mutation(anyApi.commands.enqueue, {
        id: crypto.randomUUID(),
        conversation: '["default","fixture-chat"]',
        kind: "send",
        payload: { text: "" },
      });
      await expect(page.locator(".command-error")).toContainText(
        "Write a message first",
      );
      await page
        .locator(".command-error")
        .getByRole("button", { name: "Dismiss error" })
        .click();
      await expect(page.locator(".command-error")).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".command-error")).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
