import { chromium, expect, type Page } from "@playwright/test";

Deno.test({
  name: "conversation rename, context, independent views, shortcuts, notices and deletion work across devices",
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
      await page.getByLabel("Device name", { exact: true }).fill(name);
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      return page;
    }
    async function newChat(page: Page) {
      const before = await page.evaluate(() =>
        localStorage.getItem("arura.view"),
      );
      await page
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
      const title = `Garden notes ${crypto.randomUUID().slice(0, 6)}`;
      await a
        .getByRole("button", { name: "Conversation actions", exact: true })
        .click();
      a.once("dialog", (dialog) => dialog.accept(title));
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
          name: "Reference a file, folder, URL, or conversation",
          exact: true,
        })
        .click();
      await a
        .getByRole("dialog", { name: "Add context", exact: true })
        .getByRole("button", { name: title, exact: true })
        .click();
      await expect(a.getByLabel("Message Hermes", { exact: true })).toHaveText(
        new RegExp(title),
      );
      await a
        .getByRole("button", {
          name: "Reference a file, folder, URL, or conversation",
          exact: true,
        })
        .click();
      await a
        .getByLabel("File, folder, or URL", { exact: true })
        .fill("/fixture/garden");
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
      await notification.click();
      await expect(
        b.locator(`.notification-card[data-notice-id="${id}"]`),
      ).not.toHaveClass(/unread/);
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
      await a
        .getByRole("button", { name: "Appearance & shortcuts", exact: true })
        .click();
      const shortcut = a.getByLabel("Find conversations and actions", {
        exact: true,
      });
      await shortcut.focus();
      await a.keyboard.press("Control+Shift+j");
      await expect(shortcut).toHaveValue("Ctrl/⌘+Shift+j");
      await b.getByRole("button", { name: "Settings", exact: true }).click();
      await b
        .getByRole("button", { name: "Appearance & shortcuts", exact: true })
        .click();
      await expect(
        b.getByLabel("Find conversations and actions", { exact: true }),
      ).toHaveValue("Ctrl/⌘+Shift+j");
      await b
        .getByRole("button", { name: "Reset shortcuts", exact: true })
        .focus();
      await b.keyboard.press("Control+Shift+j");
      await expect(
        b.getByRole("dialog", { name: "Find anything", exact: true }),
      ).toBeVisible();
      await b.keyboard.press("Escape");
      await a
        .getByRole("button", { name: "Reset shortcuts", exact: true })
        .click();
      await a.getByRole("button", { name: title, exact: true }).click();
      await a
        .getByRole("button", { name: "Conversation actions", exact: true })
        .click();
      a.once("dialog", (dialog) => dialog.accept());
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
