import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";

Deno.test({
  name:
    "sidebar settings, host files, profile selection, and archive navigation",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Sidebar actions");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Settings", exact: true }),
      ).toHaveCount(1);
      await expect(
        page
          .locator(".nav-footer")
          .getByRole("button", { name: "Settings", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Select profile")).toContainText("default");
      const files = page.waitForRequest(
        (request) => new URL(request.url()).pathname === "/api/resource/files",
      );
      await page.getByRole("button", { name: "Files", exact: true }).click();
      expect(new URL((await files).url()).searchParams.get("path")).toBe("~");
      await expect(page.getByLabel("Host directory")).toHaveValue("~");
      await expect(
        page.getByText("Path is required", { exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Threads", exact: true }).click();
      const threadCount = await page
        .locator(".desktop-navigation .thread-row")
        .count();
      await page
        .getByRole("button", { name: "New conversation", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .toBe("");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "New conversation", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "New conversation", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Conversation actions", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".desktop-navigation .thread-row")).toHaveCount(
        threadCount,
      );
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("First message creates a thread");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Received: First message creates a thread", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Conversation actions", exact: true })
        .click();
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .toBe("");
      await expect(
        page.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      const created = await page.request.post(
        new URL("/api/resource/createProfile", page.url()).href,
        {
          data: { name: "sidebar-profile" },
          headers: { Origin: new URL(page.url()).origin },
        },
      );
      expect(created.ok()).toBe(true);
      await page.getByLabel("Select profile").click();
      await expect(
        page
          .getByRole("dialog", { name: "Switch profile" })
          .getByRole("button", { name: "sidebar-profile", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: "/var/tmp/arura-profile-picker.png" });
      await page
        .getByRole("dialog", { name: "Switch profile" })
        .getByRole("button", { name: "sidebar-profile", exact: true })
        .click();
      await page
        .getByRole("button", { name: "New conversation", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .toBe("");
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Profile draft");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("arura.view") || "[]")[0],
          )
        )
        .toBe("sidebar-profile");
      await page
        .getByRole("button", { name: "Conversation actions", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete conversation", exact: true })
        .click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .toBe("");
    } finally {
      await browser.close();
    }
  },
});
