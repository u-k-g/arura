import { chromium, expect } from "@playwright/test";

Deno.test({
  name: "Hermes layout and shared pin/archive state in both directions",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1360, height: 900 },
      colorScheme: "dark",
    });
    const hermes = Deno.env.get("HERMES_URL")!;
    const originalConfig = await (await fetch(`${hermes}/api/config`)).json();
    const rows = await (
      await fetch(`${hermes}/api/sessions?profile=default`)
    ).json();
    const source = rows.sessions.find(
      (row: { title: string }) => row.title === "Fixture conversation",
    );
    const metadata = async (values: Record<string, boolean | string>) => {
      const response = await fetch(`${hermes}/api/sessions/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ profile: "default", ...values }),
        headers: { "content-type": "application/json" },
      });
      expect(response.ok).toBe(true);
    };
    const read = async () => {
      const data = await (
        await fetch(`${hermes}/api/sessions?profile=default`)
      ).json();
      return data.sessions.find((row: { id: string }) => row.id === source.id);
    };
    try {
      await metadata({ pinned: true, archived: false });
      await page.goto(Deno.env.get("ARURA_TEST_URL")!);
      await page
        .getByLabel("Device name", { exact: true })
        .fill("Hermes layout review");
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Conversation actions", exact: true })
        .click();
      const pin = page.getByRole("button", {
        name: "Toggle pinned",
        exact: true,
      });
      await expect(pin).toHaveAttribute("aria-pressed", "true");
      await pin.click();
      await expect
        .poll(async () => (await read()).pinned, { timeout: 15000 })
        .toBe(false);
      await metadata({ pinned: true });
      await expect(
        page
          .locator(".nav-scroll")
          .getByRole("button", { name: "Fixture conversation", exact: true }),
      ).toBeVisible();
      await metadata({ archived: true, pinned: false });
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      const restore = page.getByRole("button", {
        name: "Unarchive Fixture conversation",
        exact: true,
      });
      await expect(restore).toBeVisible({ timeout: 15000 });
      await restore.click();
      await expect
        .poll(async () => (await read()).archived, { timeout: 15000 })
        .toBe(false);
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Capabilities", exact: true }),
      ).toHaveCount(0);
      await expect(
        page
          .locator(".topbar")
          .getByRole("button", { name: "New conversation", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Model", exact: true }),
      ).toBeVisible();
      const composer = await page.locator(".composer").boundingBox();
      expect(composer!.height).toBeLessThan(65);
      const sidebar = await page.locator(".desktop-navigation").boundingBox();
      expect(sidebar!.width).toBe(247);
      const prompt =
        "Compare the two options.\n\n| Option | Benefit |\n| --- | --- |\n| One | Less weight |\n| Two | More tread |\n\nThe choice depends on the course and conditions.";
      await page.getByLabel("Message Hermes", { exact: true }).fill(prompt);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: Compare the two options." }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toHaveCount(0, { timeout: 15000 });
      // Background history remains in Hermes, but doesn't flood local recents.
      const sessionRow = page
        .locator(".nav-scroll .thread-select")
        .filter({ hasText: "Fixture conversation" });
      for (const source of ["cron", "subagent", "tool", "kanban"]) {
        await metadata({ source, pinned: false });
        await expect(sessionRow).toHaveCount(0, { timeout: 15000 });
        expect(await read()).toBeTruthy();
      }
      // An explicit pin is still honored, including for a background session.
      await metadata({ pinned: true });
      await expect(sessionRow).toBeVisible({ timeout: 15000 });
      await metadata({ source: "desktop", pinned: false });
      await expect(sessionRow).toBeVisible({ timeout: 15000 });
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/hermes-desktop.png`,
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Capabilities", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Capabilities", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/hermes-mobile.png`,
      });
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Conversations", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `${Deno.env.get("TMPDIR")}/hermes-mobile-sheet.png`,
      });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      const rawConfig = await (await fetch(`${hermes}/api/config`)).json();
      await fetch(`${hermes}/api/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: {
            ...rawConfig.config,
            sessions: { auto_archive: false, auto_archive_days: 14 },
          },
        }),
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Conversations & archive", exact: true })
        .click();
      await expect(page.getByRole("spinbutton")).toHaveValue("14", {
        timeout: 15000,
      });
      await expect(page.getByRole("checkbox")).not.toBeChecked();
      await page.getByRole("spinbutton").fill("21");
      await page.getByRole("spinbutton").press("Tab");
      await expect
        .poll(async () => {
          const config = await (await fetch(`${hermes}/api/config`)).json();
          return config.config.sessions;
        })
        .toEqual({ auto_archive: false, auto_archive_days: 21 });
    } finally {
      const url = Deno.env.get("ARURA_TEST_URL")!;
      const restored = await page.request.put(
        `${url}/api/resource/saveConfig`,
        {
          headers: { origin: url },
          data: {
            config: {
              ...originalConfig.config,
              sessions: originalConfig.config.sessions ?? {
                auto_archive: true,
                auto_archive_days: 7,
              },
            },
          },
        },
      );
      expect(restored.ok()).toBe(true);
      await page.close();
      await browser.close();
    }
  },
});
