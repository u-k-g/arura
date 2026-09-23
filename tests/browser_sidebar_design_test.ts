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
      const row = page.locator(".nav-scroll .thread-row.selected");
      await page.mouse.move(900, 700);
      await expect(row.locator(".session-dot")).toBeVisible();
      await expect(row.locator(".session-age")).toBeVisible();
      await row.hover();
      const hoverLayout = await row.evaluate((element) => {
        const dot = element.querySelector(".session-dot")!;
        const age = element.querySelector(".session-age")!;
        const menu = element.querySelector(".row-menu-button")!;
        const archive = element.querySelector(".archive-button")!;
        return {
          dotHidden: getComputedStyle(dot).visibility === "hidden",
          ageHidden: getComputedStyle(age).visibility === "hidden",
          menuLeft: menu.getBoundingClientRect().left,
          archiveRight: archive.getBoundingClientRect().right,
          rowLeft: element.getBoundingClientRect().left,
          rowRight: element.getBoundingClientRect().right,
        };
      });
      expect(hoverLayout.dotHidden).toBe(true);
      expect(hoverLayout.ageHidden).toBe(true);
      expect(hoverLayout.menuLeft - hoverLayout.rowLeft).toBeLessThan(3);
      expect(hoverLayout.rowRight - hoverLayout.archiveRight).toBeLessThan(3);
      await row.getByRole("button", {
        name: "Actions for Fixture conversation",
      }).click();
      await page.getByRole("button", { name: "Mark as unread" }).click();
      await expect(row).toHaveClass(/unread/);
      const unreadColor = await row.locator(".session-dot").evaluate((dot) =>
        getComputedStyle(dot).backgroundColor
      );
      await row.getByRole("button", {
        name: "Actions for Fixture conversation",
      }).click();
      await page.getByRole("button", { name: "Mark as read" }).click();
      await expect(row).not.toHaveClass(/unread/);
      const readColor = await row.locator(".session-dot").evaluate((dot) =>
        getComputedStyle(dot).backgroundColor
      );
      expect(unreadColor).not.toBe(readColor);
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
          .locator(".pinned-divider")
          .getByRole("button", { name: "New conversation", exact: true })
          .boundingBox(),
        "new thread",
      );
      expect(newThread.y).toBeGreaterThan(sidebar.y);
      expect(newThread.y).toBeLessThan(sidebar.y + sidebar.height);
      await tile.click({ button: "right" });
      await page
        .getByRole("button", { name: "Toggle pinned", exact: true })
        .click();
      await expect(page.locator(".pinned-divider")).toBeVisible();
      await page
        .getByRole("button", {
          name: "Archive Fixture conversation",
          exact: true,
        })
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
