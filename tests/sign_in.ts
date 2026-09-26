import type { Page } from "@playwright/test";

export async function signIn(page: Page, name: string) {
  // Give test devices distinct names without an extra field in the sign-in UI.
  await page.route(
    "**/auth/login",
    async (route) => {
      await route.continue({
        postData: JSON.stringify({ ...route.request().postDataJSON(), name }),
      });
    },
    { times: 1 },
  );
  await page.getByLabel("Username", { exact: true }).fill("fixture");
  await page.getByLabel("Password", { exact: true }).fill("fixture-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function openSettings(page: Page) {
  if (await page.locator(".resource-dialog").isVisible()) {
    await page
      .locator(".resource-dialog > .dialog-inner > header")
      .getByRole("button", { name: "Close", exact: true })
      .click();
  }
  const navigation = page.getByRole("navigation", {
    name: "Settings sections",
    exact: true,
  });
  if (await navigation.isVisible().catch(() => false)) return;
  const settingsTab = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Settings", exact: true });
  if (!(await settingsTab.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: /Open (conversations|Settings)/ })
      .click();
  }
  if ((await settingsTab.getAttribute("aria-current")) !== "page") {
    await settingsTab.click();
  }
  if (!(await navigation.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Open Settings", exact: true })
      .click();
  }
}
