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
      await page.getByLabel("Message Hermes", { exact: true }).focus();
      const row = page.locator(".nav-scroll .thread-row.selected");
      await page.mouse.move(900, 700);
      await expect(row.locator(".session-dot")).toBeVisible();
      await expect(row.locator(".session-age")).toBeVisible();
      await expect(row.locator(".busy-dot")).toHaveCount(0);
      const restingLayout = await row.evaluate((element) => ({
        ageRight: element.querySelector(".session-age")?.getBoundingClientRect()
          .right,
        rowRight: element.getBoundingClientRect().right,
      }));
      expect(
        restingLayout.rowRight - (restingLayout.ageRight ?? 0),
      ).toBeLessThan(12);
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
      await row
        .getByRole("button", {
          name: "Actions for Fixture conversation",
        })
        .click();
      await page.getByRole("button", { name: "Mark as unread" }).click();
      await expect(row).toHaveClass(/unread/);
      const unreadColor = await row
        .locator(".session-dot")
        .evaluate((dot) => getComputedStyle(dot).backgroundColor);
      await row
        .getByRole("button", {
          name: "Actions for Fixture conversation",
        })
        .click();
      await page.getByRole("button", { name: "Mark as read" }).click();
      await expect(row).not.toHaveClass(/unread/);
      await page.mouse.move(900, 700);
      await expect
        .poll(() =>
          row
            .locator(".row-menu-button")
            .evaluate((button) => getComputedStyle(button).opacity)
        )
        .toBe("0");
      await expect(row.locator(".session-dot")).toBeVisible();
      await expect(row.locator(".session-age")).toBeVisible();
      const readColor = await row
        .locator(".session-dot")
        .evaluate((dot) => getComputedStyle(dot).backgroundColor);
      expect(unreadColor).not.toBe(readColor);
      const statusColors = await row.evaluate((element) => {
        const dot = element.querySelector(".session-dot");
        if (!dot) throw new Error("Missing status dot");
        const sample = globalThis.document.createElement("span");
        globalThis.document.body.append(sample);
        const color = (variable: string) => {
          sample.style.background = `var(${variable})`;
          return getComputedStyle(sample).backgroundColor;
        };
        const muted = getComputedStyle(dot).backgroundColor;
        element.classList.add("unread");
        const unread = getComputedStyle(dot).backgroundColor;
        element.classList.add("running");
        const running = getComputedStyle(dot).backgroundColor;
        element.classList.remove("unread", "running");
        const warning = color("--warning");
        const success = color("--success");
        sample.remove();
        return { muted, unread, running, warning, success };
      });
      expect(statusColors.unread).toBe(statusColors.warning);
      expect(statusColors.running).toBe(statusColors.success);
      expect(statusColors.muted).toBe(readColor);
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
      const iconColors = await tile.evaluate((button) => {
        const icon = button.querySelector(".icon");
        if (!icon) throw new Error("Missing Essentials icon");
        const current = getComputedStyle(icon).color;
        button.classList.add("unread");
        const unread = getComputedStyle(icon).color;
        button.classList.add("running");
        const running = getComputedStyle(icon).color;
        button.classList.remove("unread", "running");
        return { current, unread, running };
      });
      expect(iconColors.current).toBe(statusColors.muted);
      expect(iconColors.unread).toBe(statusColors.warning);
      expect(iconColors.running).toBe(statusColors.success);
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
      await expect(picker.getByRole("button", { name: "Windows" })).toHaveCount(
        0,
      );
      await expect(
        picker.getByRole("button", { name: "Settings" }),
      ).toHaveCount(0);
      await page.screenshot({
        path: "/var/tmp/arura-essential-icon-picker.png",
      });
      const iconSearch = picker.getByRole("searchbox", {
        name: "Search icons",
      });
      await iconSearch.fill("arc3d");
      await expect(
        picker.getByRole("button", { name: "3D Arc" }),
      ).toBeVisible();
      await iconSearch.fill("money");
      await expect(picker.getByRole("button", { name: "Coins" })).toBeVisible();
      await iconSearch.fill("vehicle");
      await expect(picker.getByRole("button", { name: "Truck" })).toBeVisible();
      await iconSearch.fill("sparkle");
      await expect(picker.getByRole("button", { name: "Spark" })).toBeVisible();
      await picker
        .getByRole("searchbox", { name: "Search icons" })
        .fill("caffeine");
      await expect(picker.locator(".essential-icon-picker button")).toHaveCount(
        1,
      );
      await picker.getByRole("button", { name: "Coffee", exact: true }).click();
      await tile.click({ button: "right" });
      await page
        .getByRole("button", { name: "Change icon", exact: true })
        .click();
      await expect(
        picker.getByRole("searchbox", { name: "Search icons" }),
      ).toHaveValue("");
      await expect(
        picker.getByRole("button", { name: "Coffee", exact: true }),
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
          .locator(".desktop-navigation .nav-footer")
          .getByRole("button", { name: "New conversation", exact: true })
          .boundingBox(),
        "new thread",
      );
      expect(newThread.y).toBeGreaterThan(sidebar.y + sidebar.height * 0.75);
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
      const loadedArchiveLayout = await archive.evaluate((list) => {
        const row = list.querySelector(".thread-row");
        const section = list.parentElement;
        if (!row || !section) throw new Error("Missing archive layout");
        const more = globalThis.document.createElement("button");
        more.className = "text-button archive-more";
        more.textContent = "Show 10 more";
        section.append(more);
        const copies: Element[] = [];
        const addRows = (count: number) => {
          for (let i = 0; i < count; i++) {
            const copy = row.cloneNode(true) as Element;
            copies.push(copy);
            list.append(copy);
          }
        };
        addRows(9);
        const tenHeight = section.getBoundingClientRect().height;
        addRows(10);
        const result = {
          tenHeight,
          twentyHeight: section.getBoundingClientRect().height,
          scrollable: list.scrollHeight > list.clientHeight,
          buttonWidth: more.getBoundingClientRect().width,
          sectionWidth: section.getBoundingClientRect().width,
        };
        for (const copy of copies) copy.remove();
        more.remove();
        return result;
      });
      expect(loadedArchiveLayout.twentyHeight).toBeCloseTo(
        loadedArchiveLayout.tenHeight,
        0,
      );
      expect(loadedArchiveLayout.scrollable).toBe(true);
      expect(loadedArchiveLayout.buttonWidth).toBeCloseTo(
        loadedArchiveLayout.sectionWidth,
        0,
      );
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
