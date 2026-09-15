import { openSettings, signIn } from "./sign_in.ts";
import { onceActionDialog } from "./action_dialog.ts";
import { chromium, expect } from "@playwright/test";

Deno.test({
  name:
    "webhook creation reveals its secret once while shared listings and caches omit it",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = Deno.env.get("ARURA_TEST_URL")!;
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await signIn(page, "Webhook test");
      await openSettings(page);
      await page
        .getByRole("button", { name: "Incoming triggers", exact: true })
        .click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("garden-trigger");
      await page
        .getByLabel("Instructions", { exact: true })
        .fill("Update garden notes");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const created = page.getByRole("dialog", {
        name: "Webhook created",
        exact: true,
      });
      await expect(
        created.getByLabel("Webhook secret", { exact: true }),
      ).toHaveValue("ONE_TIME_WEBHOOK_SECRET_DO_NOT_CACHE");
      const listing = await (
        await page.request.get(`${url}/api/resource/webhooks`)
      ).json();
      expect(JSON.stringify(listing)).not.toContain("ONE_TIME_WEBHOOK_SECRET");
      await created.getByRole("button", { name: "Close", exact: true }).last()
        .click();
      const card = page
        .locator(".resource-card")
        .filter({ hasText: "garden-trigger" });
      await card
        .getByRole("button", { name: "Enable or disable", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(`${url}/api/resource/webhooks`)
              ).json()
            ).subscriptions[0].enabled,
        )
        .toBe(false);
      await page.reload();
      await expect(created).toHaveCount(0);
      expect(
        await page.evaluate(() => JSON.stringify(localStorage)),
      ).not.toContain("ONE_TIME_WEBHOOK_SECRET");
      const cached = await page.evaluate(async () => {
        const request = indexedDB.open("arura");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await Promise.all(
            Array.from(db.objectStoreNames).map(
              (name) =>
                new Promise((resolve, reject) => {
                  const read = db.transaction(name).objectStore(name).getAll();
                  read.onsuccess = () => resolve(read.result);
                  read.onerror = () => reject(read.error);
                }),
            ),
          );
        } finally {
          db.close();
        }
      });
      expect(JSON.stringify(cached)).not.toContain("ONE_TIME_WEBHOOK_SECRET");
      void onceActionDialog(page, (dialog) => dialog.accept());
      await card.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(card).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
