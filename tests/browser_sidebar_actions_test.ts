import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";

Deno.test({
  name: "sidebar settings, artifacts, default profile, and archive navigation",
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
      await expect(page.locator(".main-view > .topbar")).toBeHidden();
      await expect(
        page
          .locator(".nav-footer")
          .getByRole("button", { name: "New conversation", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".pinned-divider").getByRole("button"),
      ).toHaveCount(0);
      const footer = page.locator(".nav-footer");
      const artifactsBox = await footer.getByRole("button", {
        name: "Artifacts",
      }).boundingBox();
      const newChatBox = await footer.getByRole("button", {
        name: "New conversation",
      }).boundingBox();
      expect(requireValue(artifactsBox, "artifacts box").x).toBeLessThan(
        requireValue(newChatBox, "new chat box").x,
      );
      for (const name of ["Artifacts", "New conversation"]) {
        const button = footer.getByRole("button", { name, exact: true });
        const resting = await button.evaluate((element) =>
          getComputedStyle(element).backgroundColor
        );
        await button.hover();
        expect(
          await button.evaluate((element) =>
            getComputedStyle(element).backgroundColor
          ),
        ).not.toBe(resting);
        await page.mouse.move(800, 400);
      }
      await expect(
        page.locator(".thread-row.selected").getByRole("button", {
          name: "Archive Fixture conversation",
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Meta+b");
      await expect(
        page
          .locator(".collapsed-controls")
          .getByRole("button", { name: "New conversation", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Control+b");
      await expect(
        page.getByRole("button", { name: "Collapse sidebar", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Collapse sidebar", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Expand sidebar", exact: true })
        .click();
      await expect(
        page.getByRole("navigation", { name: "Main navigation" })
          .getByRole("button", { name: "Cron jobs" })
          .locator('path[d^="M21.6669 16.6667"]'),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Settings", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" })
          .getByRole("button", { name: "Settings", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Select profile")).toHaveCount(0);
      await expect(page.locator(".sidebar-titlebar .profile-name"))
        .toHaveCount(0);
      const gateway = page
        .locator(".sidebar-titlebar")
        .getByRole("button", { name: /^Gateway (connected|disconnected)$/ });
      await expect(gateway).toBeVisible();
      expect((await gateway.textContent())?.trim()).toBe("");
      await expect(
        page.getByRole("button", { name: "Files", exact: true }),
      ).toHaveCount(0);
      await page
        .locator(".nav-footer")
        .getByRole("button", { name: "Artifacts", exact: true })
        .click();
      await expect(
        page.getByRole("searchbox", { name: "Search generated files" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Host files", exact: true }),
      ).toHaveCount(0);
      const removed = await page.request.get(
        new URL("/api/resource/files?path=~", page.url()).href,
      );
      expect(removed.ok()).toBe(false);
      await page.evaluate(() =>
        localStorage.setItem("arura.view", "resources:files?path=%2Ftmp")
      );
      await page.reload();
      await expect(
        page.getByRole("searchbox", { name: "Search generated files" }),
      ).toBeVisible();
      await page.screenshot({ path: "/var/tmp/arura-artifacts-footer.png" });
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
        .locator(
          '.thread-row.selected > .icon-button[aria-label^="Actions for"]',
        )
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
      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Settings", exact: true }).click();
      await page.keyboard.press("Meta+b");
      await expect(
        page.getByRole("button", { name: "Expand sidebar", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Meta+b");
      await expect(
        page.getByRole("navigation", { name: "Settings sections" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Conversations & archive" })
        .click();
      await page.getByLabel("Default profile").selectOption("sidebar-profile");
      await expect(page.getByLabel("Default profile"))
        .toHaveValue("sidebar-profile");
      await page.getByRole("button", { name: "Threads", exact: true }).click();
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
      await expect(page.getByText("Received: Profile draft", { exact: true }))
        .toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("arura.view") || "[]")[0],
          )
        )
        .toBe("sidebar-profile");
      await page
        .locator(
          '.thread-row.selected > .icon-button[aria-label^="Actions for"]',
        )
        .click();
      await expect(
        page.getByRole("button", { name: "Delete conversation", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(page.locator(".archive-list .row-menu-button"))
        .toHaveCount(0);
      await expect(page.locator(".archive-list .unarchive-button").first())
        .toBeVisible();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .toBe("");
      await page.setViewportSize({ width: 390, height: 800 });
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      const sheet = page.getByRole("dialog", { name: "Conversations" });
      await expect(sheet.locator(".sidebar-titlebar")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Select profile" }))
        .toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
});
