import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { signIn } from "./sign_in.ts";
import { onceActionDialog } from "./action_dialog.ts";
import { requireValue } from "./require_value.ts";

Deno.test({
  name:
    "large tool history survives edits and repeated refresh errors stay in one retryable notice",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const source = `${Deno.env.get("HERMES_URL")}/api/sessions/fixture-chat`;
    const original = await (await fetch(`${source}/messages?limit=500`)).json();
    const patch = async (messages: unknown[]) => {
      const response = await fetch(source, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      expect(response.ok).toBe(true);
    };
    try {
      await patch([
        { id: 90001, role: "user", content: "Earlier research" },
        {
          id: 90002,
          role: "tool",
          name: "web_extract",
          content: "Mountain 🌄 ".repeat(45000),
        },
        { id: 90003, role: "assistant", content: "Earlier answer preserved" },
        { id: 90004, role: "user", content: "Old edited instruction" },
        { id: 90005, role: "assistant", content: "Old answer replaced" },
        { id: 90006, role: "user", content: "Later prompt removed" },
        { id: 90007, role: "assistant", content: "Later answer removed" },
      ]);
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "App URL"));
      await signIn(page, "Large history");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await expect(
        page.getByText("Later answer removed", { exact: true }),
      ).toBeVisible();
      await page
        .locator("article.user")
        .filter({ hasText: "Old edited instruction" })
        .getByRole("button", { name: "Edit and resubmit", exact: true })
        .click();
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Revised trip comparison");
      void onceActionDialog(page, async (dialog) => await dialog.accept());
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Received: Revised trip comparison", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Earlier answer preserved", { exact: true }),
      ).toHaveCount(1);
      for (
        const text of [
          "Old edited instruction",
          "Old answer replaced",
          "Later prompt removed",
          "Later answer removed",
        ]
      ) {
        await expect(page.getByText(text, { exact: true })).toHaveCount(0);
      }
      await page.reload();
      await expect(
        page.getByText("Received: Revised trip comparison", { exact: true }),
      ).toBeVisible();
      const auth = await (
        await page.request.get(`${Deno.env.get("ARURA_TEST_URL")}/auth/token`)
      ).json();
      const client = new ConvexHttpClient(
        requireValue(Deno.env.get("CONVEX_SELF_HOSTED_URL"), "Convex URL"),
      );
      client.setAuth(auth.token);
      const conversation = '["default","fixture-chat"]';
      // Invalid offsets fail without changing Hermes; mimic repeated background failures.
      for (let i = 0; i < 8; i++) {
        await client.mutation(anyApi.commands.enqueue, {
          id: crypto.randomUUID(),
          conversation,
          kind: "load",
          payload: { offset: 1 },
        });
      }
      await expect(page.locator(".history-error")).toHaveCount(1);
      await expect(page.locator(".command-error")).toHaveCount(0);
      await expect
        .poll(async () => {
          const result = await client.query(anyApi.workspace.transcript, {
            conversation,
            pages: 1,
          });
          return result.commands.filter(
            (c: { kind: string; status: string }) =>
              c.kind === "load" && c.status === "error",
          ).length;
        })
        .toBe(8);
      await page
        .getByRole("button", { name: "Retry history", exact: true })
        .click();
      await expect(page.locator(".history-error")).toHaveCount(0);
      await expect(
        page.getByText("Received: Revised trip comparison", { exact: true }),
      ).toHaveCount(1);
    } finally {
      await patch(original.messages);
      await browser.close();
    }
  },
});
