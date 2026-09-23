import { chromium, expect } from "@playwright/test";
import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";

Deno.test({
  name: "a six-day-old conversation warns before a seven-day autoarchive",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const hermes = requireValue(
      Deno.env.get("HERMES_URL"),
      "Hermes fixture URL",
    );
    const config = (await (await fetch(`${hermes}/api/config`)).json()).config;
    const sessions = (await (await fetch(`${hermes}/api/sessions`)).json())
      .sessions;
    const original = sessions.find((row: { id: string }) =>
      row.id === "fixture-chat"
    );
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      await page.goto(requireValue(Deno.env.get("ARURA_TEST_URL"), "test URL"));
      await signIn(page, "Archive warning");
      await page.getByRole("button", {
        name: "Fixture conversation",
        exact: true,
      }).click();
      await fetch(`${hermes}/api/config`, {
        method: "PUT",
        body: JSON.stringify({
          config: {
            ...config,
            sessions: {
              ...(config.sessions ?? {}),
              auto_archive: true,
              auto_archive_days: 7,
            },
          },
        }),
      });
      await fetch(`${hermes}/api/sessions/fixture-chat`, {
        method: "PATCH",
        body: JSON.stringify({
          last_active: (Date.now() - 6 * 86_400_000 - 60_000) / 1000,
          messages: [{
            id: 987654,
            role: "user",
            content: "Archive warning fixture",
            timestamp: (Date.now() - 6 * 86_400_000 - 60_000) / 1000,
          }],
        }),
      });
      const row = page.locator(".nav-scroll .thread-row").filter({
        has: page.getByRole("button", {
          name: "Fixture conversation",
          exact: true,
        }),
      });
      const age = row.locator(".session-age");
      await expect(age).toHaveText("6d", { timeout: 15000 });
      await expect(age).toHaveClass(/archive-warning/, { timeout: 15000 });
      const colors = await age.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--warning)";
        document.body.appendChild(probe);
        const actual = getComputedStyle(element).color;
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return { actual, expected };
      });
      expect(colors.actual).toBe(colors.expected);
    } finally {
      await fetch(`${hermes}/api/config`, {
        method: "PUT",
        body: JSON.stringify({ config }),
      });
      await fetch(`${hermes}/api/sessions/fixture-chat`, {
        method: "PATCH",
        body: JSON.stringify({
          last_active: original.last_active,
          messages: original.messages,
        }),
      });
      await browser.close();
    }
  },
});
