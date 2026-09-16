import { requireValue } from "./require_value.ts";
import { openSettings, signIn } from "./sign_in.ts";
import { onceActionDialog } from "./action_dialog.ts";
import { chromium, expect, type Page } from "@playwright/test";
Deno.test({
  name:
    "conversation rename, context, independent views and deletion work across devices",
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
    async function device(name: string) {
      const page = await browser.newPage();
      await page.goto(url);
      await signIn(page, name);
      return page;
    }
    async function newChat(page: Page) {
      await page
        .locator(".sidebar-titlebar, .topbar, .nav-footer")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .toBe("");
      await expect(
        page.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Start navigation test");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Received: Start navigation test", { exact: true }),
      ).toBeVisible();
      return page.evaluate(() => localStorage.getItem("arura.view"));
    }
    try {
      const a = await device("Navigation desktop"),
        b = await device("Navigation second device");
      const original = await newChat(a);
      await a.getByLabel("Message Hermes", { exact: true }).focus();
      await a.keyboard.press("Meta+k");
      await expect(
        a.getByRole("dialog", { name: "Find anything" }),
      ).toBeVisible();
      await a.keyboard.press("Escape");
      await expect(
        a.getByRole("dialog", { name: "Find anything" }),
      ).toHaveCount(0);

      // A reconciliation and reload must preserve the newly started thread.
      await a.waitForTimeout(6000);
      await a.reload();
      await expect(
        a.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      await expect(
        a.getByText("Session not found", { exact: true }),
      ).toHaveCount(0);
      await expect(a.locator(".topbar")).not.toContainText(
        requireValue(original, "original"),
      );
      const title = `Garden notes ${crypto.randomUUID().slice(0, 6)}`;
      await a
        .locator(
          '.thread-row.selected > .icon-button[aria-label^="Actions for"]',
        )
        .click();
      void onceActionDialog(a, (dialog) => dialog.accept(title));
      await a.getByRole("button", { name: "Rename", exact: true }).click();
      await expect(
        b.getByRole("button", { name: title, exact: true }),
      ).toBeVisible();
      await b.getByRole("button", { name: title, exact: true }).click();
      const other = await newChat(a);
      expect(other).not.toBe(original);
      expect(await b.evaluate(() => localStorage.getItem("arura.view"))).toBe(
        original,
      );
      await a
        .getByRole("button", {
          name: "Add context",
          exact: true,
        })
        .click();
      await a
        .getByRole("dialog", { name: "Add context", exact: true })
        .getByRole("button", { name: title, exact: true })
        .click();
      await expect(a.getByLabel("Message Hermes", { exact: true })).toHaveText(
        `@session:${JSON.parse(requireValue(original, "original"))[0]}/${
          JSON.parse(requireValue(original, "original"))[1]
        }`,
      );
      await a
        .getByRole("button", {
          name: "Add context",
          exact: true,
        })
        .click();
      await a.getByLabel("Reference", { exact: true }).fill("/fixture/garden");
      await a
        .getByRole("button", { name: "Attach reference", exact: true })
        .click();
      await expect(a.getByLabel("Message Hermes", { exact: true })).toHaveText(
        /\/fixture\/garden/,
      );
      await b
        .getByLabel("Message Hermes", { exact: true })
        .fill("Summarize garden notes");
      await b
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        b
          .locator(".markdown")
          .filter({ hasText: "Received: Summarize garden notes" }),
      ).toBeVisible();
      await expect(
        a.getByRole("button", { name: "Notifications", exact: true }),
      ).toHaveCount(0);
      await a.getByLabel("More composer actions", { exact: true }).click();
      await a
        .getByRole("button", { name: "Delegated work", exact: true })
        .click();
      const delegated = a.getByRole("dialog", {
        name: "Delegated work",
        exact: true,
      });
      await delegated
        .getByRole("button", { name: "View progress", exact: true })
        .click();
      await expect(delegated).toContainText("Comparing native plant options");
      expect(await delegated.innerText()).not.toContain("NEVER_EXPOSE");
      expect(await delegated.innerText()).not.toContain("secret-query");
      await delegated
        .getByRole("button", { name: "Stop task", exact: true })
        .click();
      await expect(delegated).toContainText("No delegated work is active");
      await delegated
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
      await openSettings(a);
      await a.getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(
        a.getByRole("heading", { name: "Keyboard shortcuts", exact: true }),
      ).toHaveCount(0);
      await a
        .locator(".settings-dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await a.getByRole("button", { name: title, exact: true }).click();
      await a
        .locator(
          '.thread-row.selected > .icon-button[aria-label^="Actions for"]',
        )
        .click();
      void onceActionDialog(a, (dialog) => dialog.accept());
      await a
        .getByRole("button", { name: "Delete conversation", exact: true })
        .click();
      await expect(
        b.getByRole("button", { name: title, exact: true }),
      ).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
