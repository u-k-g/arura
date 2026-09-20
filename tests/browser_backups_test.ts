import { requireValue } from "./require_value.ts";
import { openSettings, signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";
Deno.test({
  name: "backup progress is shared and completed archives download using the returned path",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = requireValue(
      Deno.env.get("ARURA_TEST_URL"),
      'Deno.env.get("ARURA_TEST_URL")',
    );
    try {
      const device = async (name: string) => {
        const page = await browser.newPage();
        await page.goto(url);
        await signIn(page, name);
        await openSettings(page);
        await page
          .getByRole("button", { name: "Maintenance & backups", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Create Hermes backup", exact: true })
          .click();
        return page;
      };
      const a = await device("Backup desktop"),
        b = await device("Backup second device");
      await a
        .getByRole("button", { name: "Create backup", exact: true })
        .click();
      await expect(
        b.getByRole("button", { name: "Creating backup…", exact: true }),
      ).toBeDisabled();
      const link = b.getByRole("link", {
        name: "Download Hermes backup",
        exact: true,
      });
      await expect(link).toBeVisible();
      await expect(
        a.getByRole("status").filter({ hasText: "Backup ready" }),
      ).toBeVisible();
      const result = await b.request.get(
        new URL(
          requireValue(
            await link.getAttribute("href"),
            '(await link.getAttribute("href"))',
          ),
          url,
        ).href,
      );
      expect(result.status()).toBe(200);
      expect(await result.text()).toBe("PK-fixture-archive");
      const workspace = await b.request.get(`${url}/api/workspace-backup`);
      expect(workspace.status()).toBe(200);
      const state = await workspace.json();
      expect(state.version).toBe(1);
      expect(Array.isArray(state.folders)).toBe(true);
      expect(state.devices).toBeUndefined();
      await a.reload();
      await expect(
        a.getByRole("link", { name: "Download Hermes backup", exact: true }),
      ).toBeVisible();
    } finally {
      await browser.close();
    }
  },
});
