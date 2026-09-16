import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { identity } from "../server/identity.ts";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";
Deno.test({
  name:
    "recovery preserves the reading anchor and keeps work before the answer after a trailing event",
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
      await signIn(page, "Recovery scroll");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await expect(page.locator(".transcript")).toBeVisible();
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Prepare recovery test");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Received: Prepare recovery test", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".history-work")).toBeVisible();
      const conversation = '["default","fixture-chat"]';
      const messages = Array.from({ length: 30 }, (_, i) => [
        {
          id: `p-${i}`,
          role: "user",
          text: `Question ${i}`,
          createdAt: 1000 + i * 100,
        },
        {
          id: `a-${i}`,
          role: "assistant",
          text: `Answer ${i}. ${"Reading content. ".repeat(30)}`,
          createdAt: 1050 + i * 100,
        },
      ]).flat();
      const turn = {
        conversation,
        text: messages.at(-1)?.text,
        startedAt: 3900,
        finishedAt: 3950,
        state: "complete",
        activity: [{ id: "tool", label: "read_file", state: "complete" }],
        interactions: [],
      };
      const publish = (recovering: boolean, prefix: typeof messages = []) =>
        adapter.mutation(anyApi.workspace.ingest, {
          page: {
            conversation,
            offset: 0,
            messages: [
              ...prefix,
              ...messages,
              {
                id: "event",
                role: "event",
                text: "Background agent work finished",
              },
            ],
            revision: crypto.randomUUID(),
            hasMore: false,
            updatedAt: Date.now(),
          },
          turn: { ...turn, recovering },
        });
      await publish(false);
      await expect(page.locator('[data-message-id="a-20"]')).toBeAttached();
      await page.locator(".transcript").evaluate(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      });
      await page.locator(".transcript").evaluate((element) => {
        element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        const target = element.querySelector('[data-message-id="a-20"]');
        if (!target) throw new Error("Missing reading target");
        element.scrollTop += target.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          35;
      });
      await expect(page.getByRole("button", { name: /latest/i })).toBeVisible();
      const offset = () =>
        page
          .locator('[data-message-id="a-20"]')
          .evaluate((element) => element.getBoundingClientRect().top);
      const before = await offset();
      await publish(true, [
        {
          id: "restored",
          role: "assistant",
          text: "Recovered earlier content. ".repeat(70),
          createdAt: 500,
        },
      ]);
      await expect(
        page.getByText("Recovering live progress from Hermes…", {
          exact: true,
        }),
      ).toBeAttached();
      await expect
        .poll(async () => Math.abs((await offset()) - before))
        .toBeLessThan(3);
      await publish(false);
      await expect(page.locator('[data-message-id="restored"]')).toHaveCount(0);
      await expect(
        page.getByText("Recovering live progress from Hermes…", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect
        .poll(async () => Math.abs((await offset()) - before))
        .toBeLessThan(3);
      const summary = page.locator(".work-summary").last();
      const answer = page.locator('[data-message-id="a-29"]');
      expect(
        requireValue(await summary.boundingBox(), "summary").y,
      ).toBeLessThan(requireValue(await answer.boundingBox(), "answer").y);
    } finally {
      await browser.close();
    }
  },
});
