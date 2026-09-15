import { chromium, expect } from "@playwright/test";

Deno.test({
  name: "Hermes password sign-in: rejection, autofill, and browser session",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(Deno.env.get("ARURA_TEST_URL")!);
      const username = page.getByLabel("Username", { exact: true });
      const password = page.getByLabel("Password", { exact: true });
      await expect(username).toHaveAttribute("autocomplete", "username");
      await expect(password).toHaveAttribute(
        "autocomplete",
        "current-password",
      );
      await expect(password).toHaveAttribute("type", "password");
      await expect(page.getByLabel("Device name", { exact: true })).toHaveCount(
        0,
      );
      await username.fill("fixture");
      await password.fill("incorrect");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "Incorrect username or password",
      );
      expect(
        (
          await page.request.get(`${Deno.env.get("ARURA_TEST_URL")}/auth/token`)
        ).status(),
      ).toBe(401);
      // Some autofill implementations set DOM values without firing input events.
      await password.evaluate((element) => {
        (element as HTMLInputElement).value = "fixture-only";
      });
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator(".app-shell")).toBeVisible();
      const auth = await page.request.get(
        `${Deno.env.get("ARURA_TEST_URL")}/auth/token`,
      );
      expect(auth.status()).toBe(200);
      expect((await auth.json()).device.name).toContain("Chrome on");
      const cookies = await page.context().cookies();
      const session = cookies.find((entry) => entry.name === "arura_session");
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe("Strict");
      expect(cookies.some((entry) => entry.name.startsWith("hermes_"))).toBe(
        false,
      );
      await page.reload();
      await expect(page.locator(".app-shell")).toBeVisible();
    } finally {
      await browser.close();
    }
  },
});
