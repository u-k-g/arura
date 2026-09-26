import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "show more keeps its row height and reveals the next archived entries",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const hermes = requireValue(Deno.env.get("HERMES_URL"), "Hermes URL");
    const socket = new WebSocket(`${hermes.replace(/^http/, "ws")}/api/ws`);
    const pending = new Map<number, (value: Record<string, string>) => void>();
    let nextId = 0;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
    };
    const rpc = (method: string, params: Record<string, string>) =>
      new Promise<Record<string, string>>((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    try {
      if (socket.readyState !== WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          socket.onopen = () => resolve();
        });
      }
      for (let i = 0; i < 21; i++) {
        const { session_id } = await rpc("session.create", {
          profile: "default",
        });
        await rpc("session.title", {
          session_id,
          title: `Archived scroll fixture ${i}`,
        });
        const response = await fetch(`${hermes}/api/sessions/${session_id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile: "default", archived: true }),
        });
        expect(response.ok).toBe(true);
      }
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "app URL"));
      await signIn(page, "Archive reveal");
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      const list = page.locator(".archive-list");
      const more = page.getByRole("button", { name: "Show 10 more" });
      await expect(more).toBeVisible({ timeout: 30000 });
      await expect(list.locator(".thread-row")).toHaveCount(10);
      await expect.poll(() =>
        list.evaluate((node) => {
          const row = node.querySelector(".thread-row");
          const button = node.parentElement?.querySelector(".archive-more");
          if (!row || !button) return Infinity;
          return Math.abs(
            button.getBoundingClientRect().height -
              row.getBoundingClientRect().height,
          );
        })
      ).toBeLessThanOrEqual(2);
      await more.click();
      await expect(list.locator(".thread-row")).toHaveCount(20, {
        timeout: 30000,
      });
      await expect
        .poll(() => list.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          list
            .locator(".thread-row")
            .nth(10)
            .evaluate((row) => {
              const list = row.parentElement;
              if (!list) return false;
              return (
                row.getBoundingClientRect().top >=
                  list.getBoundingClientRect().top - 1
              );
            })
        )
        .toBe(true);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Open conversations" }).click();
      const mobileList = page.locator(".navigation-sheet .archive-list");
      await expect.poll(() =>
        mobileList.evaluate((node) => {
          const row = node.querySelector(".thread-row");
          const button = node.parentElement?.querySelector(".archive-more");
          if (!row || !button) return Infinity;
          return Math.abs(
            button.getBoundingClientRect().height -
              row.getBoundingClientRect().height,
          );
        })
      ).toBeLessThanOrEqual(2);
    } finally {
      socket.close();
      await browser.close();
    }
  },
});
