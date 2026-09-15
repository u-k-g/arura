import { signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";

Deno.test({
  name: "archive reconnects after cached startup on desktop and mobile",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const url = Deno.env.get("ARURA_TEST_URL")!;
    const source = `${Deno.env.get("HERMES_URL")}/api/sessions/fixture-chat`;
    const archive = async (archived: boolean) => {
      const response = await fetch(source, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: "default", archived, pinned: false }),
      });
      expect(response.ok).toBe(true);
    };
    try {
      await archive(false);
      await page.goto(url);
      await signIn(page, "Archive cached startup");
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        if (width === 390) {
          await page
            .getByRole("button", { name: "Open conversations", exact: true })
            .click();
        }
        const control = page.getByRole("button", {
          name: "Archived",
          exact: true,
        });
        if ((await control.getAttribute("aria-expanded")) !== "true") {
          await control.click();
        }
        await expect(page.locator(".archive-status:visible")).toHaveText(
          "No archived conversations.",
        );
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route("**/api/bootstrap", async (route) => {
          await gate;
          await route.continue();
        });
        try {
          await page.reload({ waitUntil: "domcontentloaded" });
          if (width === 390) {
            await page
              .getByRole("button", { name: "Open conversations", exact: true })
              .click();
          }
          await control.click();
          await expect(control).toHaveAttribute("aria-expanded", "true");
          await expect(page.locator(".archive-status:visible")).toHaveText(
            "No archived conversations.",
          );
          await archive(true);
        } finally {
          release();
        }
        await page.unrouteAll({ behavior: "wait" });
        const restore = page.getByRole("button", {
          name: "Unarchive Fixture conversation",
          exact: true,
        });
        await expect(restore).toBeVisible({ timeout: 15000 });
        await restore.click();
        await expect(restore).toHaveCount(0);
        await expect
          .poll(async () => {
            const rows = await (
              await fetch(
                `${Deno.env.get("HERMES_URL")}/api/sessions?profile=default`,
              )
            ).json();
            return rows.sessions.find(
              (row: { id: string }) => row.id === "fixture-chat",
            )?.archived;
          })
          .toBe(false);

        await expect(page.locator(".archive-status:visible")).toHaveText(
          "No archived conversations.",
        );
        await control.click();
        await expect(control).toHaveAttribute("aria-expanded", "false");
      }
    } finally {
      await archive(false);
      await browser.close();
    }
  },
});
