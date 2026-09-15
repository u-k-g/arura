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
