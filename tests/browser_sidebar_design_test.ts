import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";

Deno.test({
  name: "quiet sidebar sections, searchable essential icons and bottom archive",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Sidebar design");
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Actions for Fixture conversation",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Toggle Essentials", exact: true })
        .click();
      const tile = page.locator(".essentials button");
      await expect(tile).toHaveCount(1);
      await expect(
        page.locator(".navigation").getByText("Essentials", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.locator(".navigation").getByText("Pinned", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Conversation actions", exact: true }),
      ).toHaveCount(0);
      await tile.click({ button: "right" });
      await page
        .getByRole("button", { name: "Change icon", exact: true })
        .click();
      const picker = page.getByRole("dialog", {
        name: "Choose an Essentials icon",
      });
      expect(
        await picker.locator(".essential-icon-picker button").count(),
      ).toBeGreaterThan(80);
      await picker
        .getByRole("searchbox", { name: "Search icons" })
        .fill("brain");
      await expect(picker.locator(".essential-icon-picker button")).toHaveCount(
        1,
      );
      await picker.getByRole("button", { name: "Brain", exact: true }).click();
      await tile.click({ button: "right" });
      await page
        .getByRole("button", { name: "Change icon", exact: true })
        .click();
      await expect(
        picker.getByRole("searchbox", { name: "Search icons" }),
      ).toHaveValue("");
      await expect(
        picker.getByRole("button", { name: "Brain", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await picker.getByRole("button", { name: "Close", exact: true }).click();
      const sidebar = requireValue(
        await page.locator(".desktop-navigation").boundingBox(),
        "sidebar",
      );
      const search = requireValue(
        await page
          .getByRole("button", { name: "Search conversations", exact: true })
          .boundingBox(),
        "search",
      );
      expect(sidebar.x + sidebar.width - search.x - search.width).toBeLessThan(
        20,
      );
      const newThread = requireValue(
        await page
          .locator(".thread-actions")
          .getByRole("button", { name: "New conversation", exact: true })
          .boundingBox(),
        "new thread",
      );
      expect(newThread.y).toBeGreaterThan(740);
      await tile.click({ button: "right" });
      await page
        .getByRole("button", { name: "Toggle pinned", exact: true })
        .click();
      await expect(page.locator(".pinned-divider")).toBeVisible();
      await page
        .locator(".thread-actions")
        .getByRole("button", { name: "Archive conversation", exact: true })
        .click();
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      const archive = page.locator(".archive-list");
      await expect(
        archive.getByRole("button", {
          name: "Fixture conversation",
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: "/var/tmp/arura-clean-sidebar-expanded.png",
      });
      await archive
        .getByRole("button", {
          name: "Unarchive Fixture conversation",
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(archive).toHaveCount(0);
      await page.screenshot({ path: "/var/tmp/arura-clean-sidebar.png" });
    } finally {
      await browser.close();
    }
  },
});
