import { chromium, expect } from "@playwright/test";
import { signIn } from "./sign_in.ts";
import { requireValue } from "./require_value.ts";

Deno.test({
  name: "bot sidebar visibility, edit action, and default profile",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Bot sidebar");
      await expect(
        page.getByRole("button", { name: "Fixture conversation", exact: true }),
      )
        .toBeVisible();
      const created = await page.request.post(
        new URL("/api/resource/createProfile", page.url()).href,
        {
          data: { name: "sidebar-bot" },
          headers: { Origin: new URL(page.url()).origin },
        },
      );
      expect(created.ok()).toBe(true);
      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Bots" }).click();
      await page.getByRole("navigation", { name: "Profiles & bots list" })
        .getByRole("button", { name: "sidebar-bot" }).click();
      await page.getByRole("button", { name: "Chat", exact: true }).click();
      const row = page.locator(".desktop-navigation .thread-row")
        .filter({
          has: page.getByRole("button", { name: "sidebar-bot", exact: true }),
        });
      await expect(row).toBeVisible();
      const botsIcon = await page.getByRole("navigation", {
        name: "Main navigation",
      }).getByRole("button", { name: "Bots" }).locator(".icon").innerHTML();
      expect(await row.locator(".archive-button .icon").innerHTML())
        .toBe(botsIcon);
      await expect(row.getByRole("button", { name: "Archive sidebar-bot" }))
        .toHaveCount(0);
      const roster = await (await page.request.get(
        new URL("/api/resource/profileRoster", page.url()).href,
      )).json();
      const sourceId = roster.profiles.find(
        (profile: { name: string }) => profile.name === "sidebar-bot",
      )?.canonical_session?.resolved_id;
      expect(sourceId).toBeTruthy();
      const externalArchive = await fetch(
        `${
          requireValue(Deno.env.get("HERMES_URL"), "Hermes fixture URL")
        }/api/sessions/${sourceId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile: "sidebar-bot", archived: true }),
        },
      );
      expect(externalArchive.ok).toBe(true);
      // Let the Hermes event and the Convex subscription cross the test stack.
      await page.waitForTimeout(1500);
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Edit bot sidebar-bot" }).click();
      await expect(page.getByRole("heading", { name: "sidebar-bot" }))
        .toBeVisible();
      const visibility = page.getByLabel("Show bot in Threads");
      await expect(visibility).toBeChecked();
      await visibility.uncheck();
      await expect(visibility).not.toBeChecked();
      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Threads" }).click();
      await expect(row).toHaveCount(0);
      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Bots" }).click();
      await page.getByRole("navigation", { name: "Profiles & bots list" })
        .getByRole("button", { name: "sidebar-bot" }).click();
      await page.getByLabel("Show bot in Threads").check();
      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Threads" }).click();
      await expect(row).toBeVisible();

      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Settings" }).click();
      await page.getByRole("navigation", { name: "Settings sections" })
        .getByRole("button", { name: "Conversations & archive" }).click();
      await page.getByLabel("Default profile").selectOption("sidebar-bot");
      await expect(page.getByLabel("Default profile")).toHaveValue(
        "sidebar-bot",
      );
      await page.getByRole("button", { name: "New conversation" }).click();
      await page.getByLabel("Message Hermes").fill("Uses selected default");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect.poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("arura.view") || "[]")[0]
        )
      ).toBe("sidebar-bot");
    } finally {
      await browser.close();
    }
  },
});
