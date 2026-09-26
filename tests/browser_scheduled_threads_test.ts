import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name:
    "newest scheduled run replaces its predecessor without losing archived runs",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const hermes = requireValue(Deno.env.get("HERMES_URL"), "Hermes fixture");
    const addRun = async (id: string, title: string) => {
      const response = await fetch(`${hermes}/api/fixture/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      expect(response.ok).toBe(true);
    };
    const row = (title: string) =>
      page.locator(".desktop-navigation .nav-scroll .thread-row")
        .filter({
          has: page.getByRole("button", { name: title, exact: true }),
        });
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Scheduled run sidebar");
      await expect(
        page.getByRole("button", { name: "Fixture conversation", exact: true }),
      )
        .toBeVisible();

      await addRun("cron_job-a_20260925_120000", "Job A run 1");
      await expect(row("Job A run 1")).toBeVisible({ timeout: 15000 });
      await addRun("cron_job-b_20260925_120100", "Job B run 1");
      await expect(row("Job B run 1")).toBeVisible({ timeout: 15000 });
      await addRun("cron_job-a_20260925_120200", "Job A run 2");
      await expect(row("Job A run 2")).toBeVisible({ timeout: 15000 });
      await expect(row("Job A run 1")).toHaveCount(0);
      await expect(row("Job B run 1")).toBeVisible();
      const sessionList = await fetch(`${hermes}/api/sessions?profile=default`);
      expect(sessionList.ok).toBe(true);
      const { sessions } = await sessionList.json();
      expect(
        sessions.some((session: { id: string }) =>
          session.id === "cron_job-a_20260925_120000"
        ),
      ).toBe(true);

      const oldActivity = await fetch(
        `${hermes}/api/sessions/cron_job-a_20260925_120000`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            profile: "default",
            last_active: Date.now() / 1000 + 100,
          }),
        },
      );
      expect(oldActivity.ok).toBe(true);
      await expect(row("Job A run 2")).toBeVisible();
      await expect(row("Job A run 1")).toHaveCount(0);

      await row("Job A run 2").hover();
      await row("Job A run 2").getByRole("button", {
        name: "Archive Job A run 2",
      }).click();
      await expect(row("Job A run 2")).toHaveCount(0);
      await expect(row("Job A run 1")).toHaveCount(0);
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(
        page.locator(".archive-list .thread-row")
          .filter({
            has: page.getByRole("button", { name: "Job A run 2", exact: true }),
          }),
      )
        .toBeVisible();

      await addRun("cron_job-a_20260925_120300", "Job A run 3");
      await expect(row("Job A run 3")).toBeVisible({ timeout: 15000 });
      await expect(row("Job A run 2")).toHaveCount(0);
      await expect(row("Job B run 1")).toBeVisible();
      await expect(
        page.locator(".archive-list .thread-row")
          .filter({
            has: page.getByRole("button", { name: "Job A run 2", exact: true }),
          }),
      )
        .toBeVisible();
    } finally {
      await browser.close();
    }
  },
});
