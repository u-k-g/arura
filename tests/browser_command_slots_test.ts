import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name:
    "command palette digits follow Essentials, Pinned, folders, and recent chats",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Command slots");
      const currentKey = () =>
        page.evaluate(() => localStorage.getItem("arura.view"));
      const actions = () =>
        page.locator(
          '.thread-row.selected > .icon-button[aria-label^="Actions for"]',
        ).click();
      const createChat = async (message: string) => {
        await page.getByRole("button", {
          name: "New conversation",
          exact: true,
        }).click();
        await page.getByLabel("Message Hermes", { exact: true }).fill(message);
        await page.getByRole("button", { name: "Send message" }).click();
        await expect(page.getByText(`Received: ${message}`, { exact: true }))
          .toBeVisible();
        return requireValue(await currentKey(), `${message} key`);
      };

      await page.getByRole("button", {
        name: "Fixture conversation",
        exact: true,
      }).click();
      const essentialKey = requireValue(await currentKey(), "Essential key");
      await actions();
      await page.getByRole("button", { name: "Toggle Essentials" }).click();

      const pinnedKey = await createChat("Slot pinned chat");
      await actions();
      await page.getByRole("button", { name: "Toggle pinned" }).click();

      const folderKey = await createChat("Slot folder chat");
      await actions();
      await page.getByRole("button", { name: "Move to folder" }).click();
      await page.getByRole("button", { name: "Create new folder" }).click();
      const folderName = page.getByRole("textbox", { name: "Rename folder" });
      await expect(folderName).toBeFocused();
      await folderName.fill("Slot folder");
      await folderName.press("Enter");

      const recentKey = await createChat("Slot recent chat");
      const expected = [essentialKey, pinnedKey, folderKey, recentKey];
      for (const [index, key] of expected.entries()) {
        await page.keyboard.press("Meta+k");
        const palette = page.getByRole("dialog", { name: "Find anything" });
        const search = palette.getByRole("combobox");
        await search.fill(String(index + 1));
        const option = palette.getByRole("option");
        await expect(option).toHaveCount(1);
        await expect(option.locator(".palette-slot"))
          .toHaveText(String(index + 1));
        await search.press("Enter");
        await expect(palette).toHaveCount(0);
        await expect.poll(currentKey).toBe(key);
      }
      await page.keyboard.press("Meta+k");
      const palette = page.getByRole("dialog", { name: "Find anything" });
      await palette.getByRole("combobox").fill("5");
      await expect(palette.getByRole("option")).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
