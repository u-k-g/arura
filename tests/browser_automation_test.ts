import { onceActionDialog } from "./action_dialog.ts";
import { chromium, expect } from "@playwright/test";

Deno.test({
  name:
    "contextual skill and schedule suggestions lead to editable schedules with lifecycle controls",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const url = Deno.env.get("ARURA_TEST_URL")!;
    try {
      await page.goto(url);
      await page
        .getByLabel("Device name", { exact: true })
        .fill("Automation test");
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      await page
        .locator(".topbar")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      const input = page.getByLabel("Message Hermes", { exact: true });
      await input.fill("Help me with gardening");
      await page
        .getByRole("button", { name: "Use gardening", exact: true })
        .click();
      await expect(input).toHaveText("/gardening Help me with gardening");
      await input.fill("Every morning summarize the garden tasks");
      await page
        .getByRole("button", { name: "Schedule this", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Create schedule",
        exact: true,
      });
      await expect(
        dialog.getByLabel("Instructions", { exact: true }),
      ).toHaveValue("Every morning summarize the garden tasks");
      await dialog
        .getByLabel("Name", { exact: true })
        .fill("Garden schedule test");
      await dialog.getByLabel("Schedule", { exact: true }).fill("0 8 * * *");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      const card = page.locator(".resource-card").filter({
        has: page.getByRole("heading", {
          name: "Garden schedule test",
          exact: true,
        }),
      });
      await expect(card).toBeVisible();
      const state = async () =>
        (
          await (await page.request.get(`${url}/api/resource/jobs`)).json()
        ).find(
          (job: Record<string, unknown>) => job.name === "Garden schedule test",
        );
      await card.getByRole("button", { name: "Pause", exact: true }).click();
      await expect.poll(async () => (await state()).enabled).toBe(false);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await card.getByRole("button", { name: "Resume", exact: true }).click();
      await expect.poll(async () => (await state()).enabled).toBe(true);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await card.getByRole("button", { name: "Run now", exact: true }).click();
      await expect
        .poll(async () => Boolean((await state()).last_run_at))
        .toBe(true);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      void onceActionDialog(page, (dialog) => dialog.accept());
      await card.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(card).toHaveCount(0);
      await page
        .locator(".topbar")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      await page.getByLabel("More composer actions", { exact: true }).click();
      await page
        .getByRole("button", { name: "Automations", exact: true })
        .click();
      const controls = page.getByRole("dialog", {
        name: "Conversation automations",
        exact: true,
      });
      await controls
        .getByLabel("Instructions", { exact: true })
        .fill("Plan a small garden");
      await controls
        .getByLabel("How to verify completion", { exact: true })
        .fill("Count exactly five plant varieties");
      await controls
        .getByRole("button", { name: "Start", exact: true })
        .click();
      const goal = controls.locator(".automation-card").filter({
        has: page.getByRole("heading", { name: "Goal", exact: true }),
      });
      await expect(goal).toContainText("Count exactly five plant varieties");
      await goal.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(goal).toContainText("paused");
      await goal.getByRole("button", { name: "Resume", exact: true }).click();
      await expect(goal).toContainText("active");
      void onceActionDialog(
        page,
        (dialog) => dialog.accept("Choose native plants"),
      );
      await goal.getByRole("button", { name: "Add step", exact: true }).click();
      await expect(goal).toContainText("Choose native plants");
      await goal.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(goal).toHaveCount(0);
      for (
        const [kind, title] of [
          ["loop", "Repeated prompt"],
          ["heartbeat", "Heartbeat"],
        ]
      ) {
        await controls
          .getByLabel("Automation", { exact: true })
          .selectOption(kind);
        await controls
          .getByLabel("Instructions", { exact: true })
          .fill("Check the garden notes");
        await controls.getByLabel("Interval", { exact: true }).fill("2h");
        await controls
          .getByRole("button", { name: "Start", exact: true })
          .click();
        const automation = controls.locator(".automation-card").filter({
          has: page.getByRole("heading", { name: title, exact: true }),
        });
        await expect(automation).toContainText("Every 7200 seconds");
        await automation
          .getByRole("button", { name: "Pause", exact: true })
          .click();
        await expect(automation).toContainText("paused");
        await automation
          .getByRole("button", { name: "Resume", exact: true })
          .click();
        await expect(automation).toContainText("active");
        await automation
          .getByRole("button", {
            name: kind === "loop" ? "Stop" : "Clear",
            exact: true,
          })
          .click();
        await expect(automation).toHaveCount(0);
      }
    } catch (error) {
      await page.screenshot({ path: "/var/tmp/arura-automation-failure.png" });
      await Deno.writeTextFile(
        "/var/tmp/arura-automation-failure.html",
        await page.content(),
      );
      throw error;
    } finally {
      await browser.close();
    }
  },
});
