import { signIn } from "./sign_in.ts";
import { onceActionDialog } from "./action_dialog.ts";
import { chromium, expect, type Page } from "@playwright/test";

Deno.test({
  name: "conversation rename, context, independent views, notices and deletion work across devices",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = Deno.env.get("ARURA_TEST_URL")!;
    async function device(name: string) {
      const page = await browser.newPage();
      await page.goto(url);
      await signIn(page, name);
      return page;
    }
    async function newChat(page: Page) {
      const before = await page.evaluate(() =>
        localStorage.getItem("arura.view"),
      );
      await page
        .locator(".topbar")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .not.toBe(before);
      await expect(
        page.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      return page.evaluate(() => localStorage.getItem("arura.view"));
    }
    try {
      const a = await device("Navigation desktop"),
        b = await device("Navigation second device");
      const original = await newChat(a);
      // Hermes hasn't saved a database row yet. A reconciliation and reload
      // must preserve the live session instead of treating it as deleted.
      await a.waitForTimeout(6000);
      await a.reload();
      await expect(
        a.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      await expect(
        a.getByText("Session not found", { exact: true }),
      ).toHaveCount(0);
      await expect(a.locator(".topbar")).not.toContainText(original!);
      const title = `Garden notes ${crypto.randomUUID().slice(0, 6)}`;
      await a
        .getByRole("button", { name: "Conversation actions", exact: true })
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
        `@session:${JSON.parse(original!)[0]}/${JSON.parse(original!)[1]}`,
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
      await a
        .getByRole("button", { name: "Notifications", exact: true })
        .click();
      await b
        .getByRole("button", { name: "Notifications", exact: true })
        .click();
      const notification = a.locator(".notification-card.unread").first();
      await expect(notification).toBeVisible();
      const id = await notification.getAttribute("data-notice-id");
      await a.locator(`.notification-card[data-notice-id="${id}"]`).click();
      await expect(
        b.locator(`.notification-card[data-notice-id="${id}"]`),
      ).not.toHaveClass(/unread/);
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
        .click();
      await a.getByRole("button", { name: "Settings", exact: true }).click();
      await a.getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(
        a.getByRole("heading", { name: "Keyboard shortcuts", exact: true }),
      ).toHaveCount(0);
      await a.getByRole("button", { name: title, exact: true }).click();
      await a
        .getByRole("button", { name: "Conversation actions", exact: true })
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
