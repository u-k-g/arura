import type { Page } from "@playwright/test";
export function onceActionDialog(
  page: Page,
  handle: (dialog: {
    message: () => string;
    accept: (value?: string) => Promise<void>;
  }) => void | Promise<void>,
) {
  return (async () => {
    const dialog = page.locator("dialog.action-dialog");
    await dialog.waitFor({ state: "visible" });
    const title = await dialog.getByRole("heading").innerText();
    await handle({
      message: () => title,
      accept: async (value) => {
        const input = dialog.getByRole("textbox");
        if (value !== undefined) await input.fill(value);
        await dialog
          .getByRole("button", {
            name: (await input.count()) ? "Save" : "Confirm",
            exact: true,
          })
          .click();
      },
    });
  })();
}
