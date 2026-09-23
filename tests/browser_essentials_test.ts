import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";
Deno.test({
  name:
    "Essentials icons sync, fill the sidebar, and toggle placement with top-bar archive",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const a = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const b = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    try {
      for (
        const [page, name] of [
          [a, "Essentials desktop"],
          [b, "Essentials second device"],
        ] as const
      ) {
        await page.goto(
          requireValue(
            Deno.env.get("ARURA_TEST_URL"),
            'Deno.env.get("ARURA_TEST_URL")',
          ),
        );
        await signIn(page, name);
        await page
          .getByRole("button", { name: "Fixture conversation", exact: true })
          .click();
      }
      const actions = () =>
        a
          .locator(
            '.thread-row.selected > .icon-button[aria-label^="Actions for"]',
          )
          .click();
      await actions();
      await expect(
        a.getByRole("button", { name: "Move to conversations", exact: true }),
      ).toHaveCount(0);
      await a
        .getByRole("button", { name: "Toggle Essentials", exact: true })
        .click();
      const tile = a
        .locator(".essentials")
        .getByRole("button", { name: "Fixture conversation", exact: true });
      await expect(tile).toBeVisible();
      expect(await tile.getAttribute("title")).toBe("Fixture conversation");
      const box = await tile.boundingBox();
      const container = await a.locator(".essentials").boundingBox();
      expect(
        Math.abs(
          requireValue(box, "box").width -
            requireValue(container, "container").width,
        ),
      ).toBeLessThan(2);
      const sizing = await tile.evaluate((button) => {
        const style = getComputedStyle(button);
        const icon = button.querySelector(".icon");
        return {
          height: button.getBoundingClientRect().height,
          iconHeight: icon?.getBoundingClientRect().height,
          paddingTop: Number.parseFloat(style.paddingTop),
          paddingBottom: Number.parseFloat(style.paddingBottom),
        };
      });
      expect(sizing.iconHeight).toBe(14);
      expect(sizing.paddingTop).toBeCloseTo(14 * 0.6, 1);
      expect(sizing.paddingBottom).toBeCloseTo(14 * 0.6, 1);
      expect(sizing.height).toBeLessThan(35);
      const selectedStyle = await tile.evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor,
        border: getComputedStyle(button).borderTopColor,
      }));
      await a.getByRole("button", { name: "New conversation", exact: true })
        .first().click();
      const idleStyle = await tile.evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor,
        border: getComputedStyle(button).borderTopColor,
      }));
      expect(selectedStyle.background).toBe(idleStyle.background);
      expect(selectedStyle.border).not.toBe(idleStyle.border);
      await tile.hover();
      await expect(tile.locator(".icon")).toBeVisible();
      await tile.click();
      await tile.click({ button: "right" });
      await a.getByRole("button", { name: "Change icon", exact: true }).click();
      await a
        .getByRole("dialog")
        .getByRole("button", { name: "Heart", exact: true })
        .click();
      await b
        .locator(".essentials")
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click({ button: "right" });
      await b.getByRole("button", { name: "Change icon", exact: true }).click();
      await expect(
        b
          .getByRole("dialog")
          .getByRole("button", { name: "Heart", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await b
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
      await expect(
        a
          .locator(".sidebar-titlebar, .topbar, .nav-footer")
          .getByRole("button", {
            name: "Toggle conversation pin",
            exact: true,
          }),
      ).toHaveCount(0);
      await a.screenshot({
        path: `${Deno.env.get("TMPDIR")}/essentials-desktop.png`,
      });
      await tile.click({ button: "right" });
      await a
        .getByRole("button", { name: "Archive", exact: true })
        .click();
      await expect(tile).toHaveCount(0);
      await a.getByRole("button", { name: "Archived", exact: true }).click();
      await a
        .locator(".archive-list")
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      await a
        .getByRole("button", {
          name: "Unarchive Fixture conversation",
          exact: true,
        })
        .click();
      await actions();
      await a.getByRole("button", { name: "Move to folder" }).click();
      await a.getByRole("button", { name: "Create new folder" }).click();
      const folderName = a.getByRole("textbox", { name: "Rename folder" });
      await expect(folderName).toBeFocused();
      await expect(folderName).toHaveValue("Untitled");
      await folderName.fill("Saved");
      await folderName.press("Enter");
      await expect(a.locator(".folder").filter({ hasText: "Saved" }))
        .toContainText("Fixture conversation");
      await a.getByRole("button", { name: "Saved", exact: true }).dblclick();
      await expect(folderName).toBeFocused();
      await folderName.fill("Library");
      await folderName.press("Enter");
      await expect(a.getByRole("button", { name: "Library", exact: true }))
        .toBeVisible();
      await expect(a.getByRole("button", { name: "New folder" }))
        .toHaveCount(0);
      await actions();
      await a.getByRole("button", { name: "Move to folder" }).click();
      await a.getByRole("button", { name: "Remove from folder" }).click();
      await actions();
      await a.getByRole("button", { name: "Move to folder" }).click();
      await a
        .getByRole("button", { name: "Move to Library", exact: true })
        .click();
      await actions();
      await expect(
        a.getByRole("button", { name: "Toggle pinned", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await a
        .getByRole("button", { name: "Toggle pinned", exact: true })
        .click();
      await actions();
      await expect(
        a.getByRole("button", { name: "Toggle pinned", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await a
        .getByRole("button", { name: "Toggle Essentials", exact: true })
        .click();
      await expect(tile).toBeVisible();
      await a.setViewportSize({ width: 390, height: 844 });
      await a
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await expect(
        a
          .getByRole("dialog")
          .locator(".essentials")
          .getByRole("button", { name: "Fixture conversation", exact: true }),
      ).toBeVisible();
      await a.screenshot({
        path: `${Deno.env.get("TMPDIR")}/essentials-mobile.png`,
      });
      await a
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
      await actions();
      await a
        .getByRole("button", { name: "Toggle Essentials", exact: true })
        .click();
      await expect
        .poll(async () => {
          const result = await (
            await fetch(
              `${Deno.env.get("HERMES_URL")}/api/sessions?profile=default`,
            )
          ).json();
          return result.sessions.find(
            (row: { id: string }) => row.id === "fixture-chat",
          )?.pinned;
        })
        .toBe(false);
    } finally {
      await browser.close();
    }
  },
});
