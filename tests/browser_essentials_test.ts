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
        await page.goto(Deno.env.get("ARURA_TEST_URL")!);
        await page.getByLabel("Device name", { exact: true }).fill(name);
        await page
          .getByLabel("Authorization code", { exact: true })
          .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
        await page
          .getByRole("button", { name: "Authorize this device", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Fixture conversation", exact: true })
          .click();
      }
      const actions = () =>
        a
          .getByRole("button", { name: "Conversation actions", exact: true })
          .click();
      await actions();
      await expect(
        a.getByRole("button", { name: "Move to conversations", exact: true }),
      ).toHaveCount(0);
      await expect(
        a
          .getByRole("dialog")
          .getByRole("button", { name: "Archive", exact: true }),
      ).toHaveCount(0);
      await a
        .getByRole("button", { name: "Toggle Essentials", exact: true })
        .click();
      const tile = a
        .locator(".essentials")
        .getByRole("button", { name: "Fixture conversation", exact: true });
      await expect(tile).toBeVisible();
      expect((await tile.textContent())?.trim()).toBe("");
      expect(await tile.getAttribute("title")).toBe("Fixture conversation");
      const box = await tile.boundingBox();
      const container = await a.locator(".essentials").boundingBox();
      expect(Math.abs(box!.width - container!.width)).toBeLessThan(2);
      await tile.click({ button: "right" });
      await a.getByRole("button", { name: "Change icon", exact: true }).click();
      await a
        .getByRole("dialog")
        .getByRole("button", { name: "Star", exact: true })
        .click();
      await b
        .locator(".essentials")
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click({ button: "right" });
      await b.getByRole("button", { name: "Change icon", exact: true }).click();
      await expect(
        b
          .getByRole("dialog")
          .getByRole("button", { name: "Star", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await b.getByRole("button", { name: "Close", exact: true }).click();
      await expect(
        a
          .locator(".topbar")
          .getByRole("button", {
            name: "Toggle conversation pin",
            exact: true,
          }),
      ).toHaveCount(0);
      await a.screenshot({
        path: `${Deno.env.get("TMPDIR")}/essentials-desktop.png`,
      });
      await a
        .getByRole("button", { name: "Archive conversation", exact: true })
        .click();
      await expect(tile).toHaveCount(0);
      await a
        .getByRole("button", { name: "Unarchive conversation", exact: true })
        .click();
      await a.getByRole("button", { name: "New folder", exact: true }).click();
      await a.getByRole("dialog").getByRole("textbox").fill("Saved");
      await a
        .getByRole("button", { name: "Create folder", exact: true })
        .click();
      await actions();
      await a
        .getByRole("button", { name: "Move to Saved", exact: true })
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
    } finally {
      await browser.close();
    }
  },
});
