import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { identity } from "../server/identity.ts";
import { normalizeMessages } from "../shared/model.ts";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "interim replies render once, completed work remains visible, and live updates preserve mobile reading position",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const adapterPid = Number(Deno.env.get("ARURA_TEST_ADAPTER_PID"));
    const adapter = new ConvexHttpClient(
      requireValue(Deno.env.get("CONVEX_SELF_HOSTED_URL"), "Convex URL"),
    );
    adapter.setAuth(await (await identity()).sign("arura:adapter"));
    const conversation = '["default","fixture-chat"]';
    const currentStartedAt = Date.now() - 5000;
    let originalMessages: ReturnType<typeof normalizeMessages> = [];
    const previous = Array.from({ length: 24 }, (_, index) => [
      {
        id: `prompt-${index}`,
        role: "user",
        text: `Question ${index}`,
        createdAt: currentStartedAt - 2500 + index * 100,
      },
      {
        id: `answer-${index}`,
        role: "assistant",
        text: `Answer ${index}. ${"Reading content. ".repeat(22)}`,
        createdAt: currentStartedAt - 2450 + index * 100,
      },
    ]).flat();
    const publish = (text: string, complete = false, includeFinal = complete) =>
      adapter.mutation(anyApi.workspace.ingest, {
        page: {
          conversation,
          offset: 0,
          messages: [
            ...previous,
            {
              id: "current-prompt",
              role: "user",
              text: "Look again",
              createdAt: currentStartedAt - 20,
            },
            {
              id: "interim",
              role: "assistant",
              text: "Let me look at it properly.",
              createdAt: currentStartedAt + 30,
            },
            {
              id: "tool",
              role: "tool",
              text: "Image inspected",
              tool: "vision_analyze",
              createdAt: currentStartedAt + 40,
            },
            ...(includeFinal
              ? [
                  {
                    id: "final",
                    role: "assistant",
                    text: "The longer top needs scissors.",
                    createdAt: currentStartedAt + 180,
                  },
                ]
              : []),
          ],
          revision: crypto.randomUUID(),
          hasMore: false,
          updatedAt: Date.now(),
        },
        turn: {
          conversation,
          text,
          startedAt: currentStartedAt,
          ...(complete ? { finishedAt: Date.now() } : {}),
          state: complete ? "complete" : "running",
          activity: [
            {
              id: "vision",
              label: "vision_analyze",
              state: complete ? "complete" : "running",
            },
          ],
          interactions: [],
        },
      });
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "URL"));
      await signIn(page, "Live mobile turn");
      await page.getByRole("button", { name: "Open conversations" }).click();
      await page
        .getByRole("button", {
          name: "Fixture conversation",
          exact: true,
        })
        .click();
      await expect(page.locator(".transcript")).toBeVisible();
      const original = await (
        await fetch(
          `${requireValue(Deno.env.get("HERMES_URL"), "Hermes URL")}/api/sessions/fixture-chat/messages`,
        )
      ).json();
      originalMessages = normalizeMessages(original.messages);
      if (adapterPid) Deno.kill(adapterPid, "SIGSTOP");
      await publish("Let me look at it properly.");
      await expect(page.locator(".history-work")).toHaveCount(24);
      await expect(page.locator(".live-message .markdown")).toHaveCount(1);
      await expect(
        page.getByText("Let me look at it properly.", {
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(page.locator('[data-message-id="interim"]')).toHaveCount(0);
      await expect(page.getByText(/Working for/)).toBeVisible();
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/live-turn-mobile.png`,
      });

      const anchor = page.locator('[data-message-id="prompt-12"]');
      await page.locator(".transcript").evaluate((element) => {
        const finger = (y: number) =>
          new Touch({
            identifier: 1,
            target: element,
            clientX: 100,
            clientY: y,
          });
        element.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            touches: [finger(300)],
          }),
        );
        element.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            touches: [finger(340)],
          }),
        );
        const target = element.querySelector('[data-message-id="prompt-12"]');
        if (!target) throw new Error("Missing reading anchor");
        element.scrollTop +=
          target.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          30;
      });
      const top = () =>
        anchor.evaluate((element) => element.getBoundingClientRect().top);
      const before = await top();
      await publish("Let me look at it properly. The top is longer.");
      await expect(page.locator(".live-message .markdown")).toContainText(
        "The top is longer.",
      );
      await expect
        .poll(async () => Math.abs((await top()) - before))
        .toBeLessThan(3);
      await publish("The longer top needs scissors.", true, false);
      await expect(page.locator(".history-work")).toHaveCount(24);
      await expect(page.locator(".live-message .markdown")).toContainText(
        "The longer top needs scissors.",
      );
      await expect(page.locator('[data-message-id="interim"]')).toHaveCount(0);
      await publish("The longer top needs scissors.", true);
      await expect(page.locator('[data-message-id="final"]')).toBeAttached();
      await expect(page.locator(".history-work")).toHaveCount(25);
      await expect(page.locator('[data-message-id="interim"]')).toHaveCount(0);
      await expect
        .poll(async () => Math.abs((await top()) - before))
        .toBeLessThan(3);
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/settled-turn-mobile.png`,
      });
    } finally {
      if (adapterPid) {
        await adapter.mutation(anyApi.workspace.ingest, {
          page: {
            conversation,
            offset: 0,
            messages: originalMessages,
            revision: crypto.randomUUID(),
            hasMore: false,
            updatedAt: Date.now(),
          },
          idleTurn: { conversation, startedAt: currentStartedAt },
        });
      }
      if (adapterPid) Deno.kill(adapterPid, "SIGCONT");
      await browser.close();
    }
  },
});
