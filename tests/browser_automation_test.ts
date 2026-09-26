import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";
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
    const url = requireValue(
      Deno.env.get("ARURA_TEST_URL"),
      'Deno.env.get("ARURA_TEST_URL")',
    );
    try {
      await page.goto(url);
      await signIn(page, "Automation test");
      await page
        .locator(".sidebar-titlebar, .topbar, .nav-footer")
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
      await card.getByRole("button", { name: "Resume", exact: true }).click();
      await expect.poll(async () => (await state()).enabled).toBe(true);
      await card
        .getByRole("button", { name: "Trigger now", exact: true })
        .click();
      await expect
        .poll(async () => Boolean((await state()).last_run_at))
        .toBe(true);
      void onceActionDialog(page, (dialog) => dialog.accept());
      await card.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(card).toHaveCount(0);
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
