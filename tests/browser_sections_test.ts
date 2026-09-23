import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "icon navigation switches main content on desktop and mobile",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    try {
      const scheduleName = "Sidebar schedule";
      const scheduleResponse = await fetch(
        `${
          requireValue(Deno.env.get("HERMES_URL"), "Hermes fixture URL")
        }/api/cron/jobs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: scheduleName,
            prompt: "Check sidebar layout",
            schedule: "0 7 * * *",
          }),
        },
      );
      expect(scheduleResponse.ok).toBe(true);
      for (const width of [1280, 390]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
        });
        await page.goto(
          requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"),
        );
        await signIn(page, `Sections ${width}`);
        const openNavigation = async () => {
          if (width === 390) {
            await page
              .getByRole("button", {
                name: /^Open (conversations|Profiles & bots|Scheduled jobs)$/,
              })
              .click();
          }
        };
        await openNavigation();
        await page
          .getByRole("button", { name: "Fixture conversation", exact: true })
          .click();
        for (
          const [label, route] of [
            ["Bots", "resources:profiles"],
            ["Cron jobs", "resources:jobs"],
            ["Threads", '["default","fixture-chat"]'],
          ]
        ) {
          await openNavigation();
          const nav = page.getByRole("navigation", {
            name: "Main navigation",
            exact: true,
          });
          await expect(nav.getByRole("button")).toHaveCount(3);
          const button = nav.getByRole("button", { name: label, exact: true });
          await expect(button).toHaveText("");
          await button.click();
          await expect
            .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
            .toBe(route);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          if (label === "Bots") {
            await expect(
              page.getByRole("heading", {
                name: "Profiles & bots",
                exact: true,
              }),
            ).toBeVisible();
          }
          if (label === "Cron jobs") {
            await expect(
              page.getByRole("heading", {
                name: "Scheduled jobs",
                exact: true,
              }),
            ).toBeVisible();
          }
          if (label !== "Threads") {
            await expect(page.locator(".main-view .resource-rail"))
              .toHaveCount(0);
            if (width === 390) await openNavigation();
            const sidebar = width === 390
              ? page.getByRole("dialog", {
                name: label === "Bots" ? "Profiles & bots" : "Scheduled jobs",
              })
              : page.locator(".desktop-navigation");
            const resourceList = sidebar.getByRole("navigation", {
              name: label === "Bots"
                ? "Profiles & bots list"
                : "Scheduled jobs list",
            });
            await expect(resourceList).toBeVisible();
            await expect(sidebar.locator(".thread-row")).toHaveCount(0);
            await page.screenshot({
              path: `/var/tmp/arura-${
                label === "Bots" ? "bots" : "jobs"
              }-${width}.png`,
            });
            if (width === 390) {
              if (label === "Bots") {
                await resourceList.locator(".resource-rail-row > button")
                  .first().click();
                await expect(sidebar).toHaveCount(0);
              } else {
                await resourceList.getByRole("button", {
                  name: scheduleName,
                  exact: true,
                }).click();
                await expect(sidebar).toHaveCount(0);
              }
            } else if (label === "Cron jobs") {
              await resourceList.getByRole("button", {
                name: scheduleName,
                exact: true,
              }).click();
            }
            if (label === "Cron jobs") {
              await expect(
                page.locator(".main-view .resource-card").getByRole(
                  "heading",
                  { name: scheduleName, exact: true },
                ),
              ).toBeVisible();
            }
          }
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  },
});
