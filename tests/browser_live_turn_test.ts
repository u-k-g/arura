import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { identity } from "../server/identity.ts";
import { normalizeMessages } from "../shared/model.ts";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name:
    "interim replies render once, completed work remains visible, and live updates preserve mobile reading position",
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
          stats: {
            tokensPerSecond: 34.2,
            milestones: [
              { at: currentStartedAt, label: "Sent" },
              { at: currentStartedAt + 1200, label: "First model token" },
              { at: currentStartedAt + 1300, label: "read_file started" },
              { at: currentStartedAt + 1300, label: "search_files started" },
              { at: currentStartedAt + 1300, label: "read_file started" },
              { at: currentStartedAt + 1400, label: "read_file returned" },
              { at: currentStartedAt + 1400, label: "read_file returned" },
              { at: currentStartedAt + 1400, label: "search_files returned" },
            ],
          },
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
          `${
            requireValue(
              Deno.env.get("HERMES_URL"),
              "Hermes URL",
            )
          }/api/sessions/fixture-chat/messages`,
        )
      ).json();
      originalMessages = normalizeMessages(original.messages);
      if (adapterPid) Deno.kill(adapterPid, "SIGSTOP");
      await publish("");
      await expect(page.locator(".live-message .work-summary")).toContainText(
        "Working for",
      );
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
      const mobileStop = page.getByRole("button", { name: "Stop response" });
      const mobileSend = page.getByRole("button", { name: "Queue message" });
      await expect(mobileStop).toBeVisible();
      await expect(page.locator(".composer-bottom .desktop-stop")).toBeHidden();
      const stopBounds = requireValue(
        await mobileStop.boundingBox(),
        "stop bounds",
      );
      const sendBounds = requireValue(
        await mobileSend.boundingBox(),
        "send bounds",
      );
      expect(stopBounds.x + stopBounds.width).toBeLessThanOrEqual(
        sendBounds.x + 8,
      );
      await page
        .locator(".live-message .message-actions")
        .getByRole("button", {
          name: "Output stats",
        })
        .click();
      const stats = page.getByRole("dialog", { name: "Output stats" });
      await expect(stats.locator(".output-stats-heading"))
        .toContainText("34.2 tps");
      await expect(stats.locator(".output-stats-heading"))
        .not.toContainText("total");
      await expect(stats).not.toContainText("Time to first output");
      await expect(stats.locator(".output-stats-timeline li")).toHaveCount(3);
      await expect(stats.locator(".output-stats-timeline li").nth(1))
        .toContainText("Tools ×3");
      await expect(stats.locator(".output-stats-timeline li").nth(1))
        .toContainText("0.1s");
      await expect(stats).not.toContainText("read_file");
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/output-stats-mobile.png`,
      });
      await stats.getByRole("button", { name: "Close" }).click();
      const messageButtons = page.locator(
        ".message.assistant .message-actions",
      ).first().locator("button");
      const infoBounds = requireValue(
        await messageButtons.nth(0).boundingBox(),
        "message info button bounds",
      );
      const copyBounds = requireValue(
        await messageButtons.nth(1).boundingBox(),
        "message copy button bounds",
      );
      expect(infoBounds.width).toBe(copyBounds.width);
      expect(infoBounds.height).toBe(copyBounds.height);
      expect(Math.abs(infoBounds.y - copyBounds.y)).toBeLessThan(1);
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
        element.scrollTop += target.getBoundingClientRect().top -
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
