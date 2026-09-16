import { requireValue } from "./require_value.ts";
import { chromium, expect } from "@playwright/test";
import { openSettings, signIn } from "./sign_in.ts";
Deno.test({
  name:
    "inline model, profile instructions and MCP edits use Hermes contracts and preserve external changes",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const url = requireValue(
      Deno.env.get("ARURA_TEST_URL"),
      'Deno.env.get("ARURA_TEST_URL")',
    );
    try {
      await page.goto(url);
      await signIn(page, "Settings contracts");
      await openSettings(page);
      await page
        .getByLabel("Default model model", { exact: true })
        .fill("fixture-alternative");
      await page
        .locator(".model-assignment")
        .first()
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(
        page.getByText("Model saved", { exact: true }),
      ).toBeVisible();
      expect(
        await (await page.request.get(`${url}/api/resource/modelInfo`)).json(),
      ).toMatchObject({ provider: "fixture", model: "fixture-alternative" });
      await page
        .getByRole("button", { name: "Profiles & bots", exact: true })
        .click();
      const instructions = page.getByLabel("Personality & instructions", {
        exact: true,
      });
      await instructions.fill("Prefer concise explanations.");
      await page
        .getByRole("button", { name: "Save instructions", exact: true })
        .click();
      await expect(
        page.getByText("Instructions saved", { exact: true }),
      ).toBeVisible();
      expect(
        await (
          await page.request.get(`${url}/api/resource/soul?id=default`)
        ).json(),
      ).toMatchObject({ content: "Prefer concise explanations." });
      await instructions.fill("My unsaved instructions");
      await page.request.put(`${url}/api/resource/saveSoul?id=default`, {
        headers: { origin: url },
        data: { content: "Edited in desktop" },
      });
      await page
        .getByRole("button", { name: "Save instructions", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "Instructions changed elsewhere",
      );
      await expect(instructions).toHaveText("My unsaved instructions");
      await openSettings(page);
      await page
        .getByRole("button", { name: "Capabilities", exact: true })
        .click();
      await page.getByRole("button", { name: "MCP", exact: true }).click();
      await page.getByText("Edit configuration", { exact: true }).click();
      const editor = page.getByLabel("MCP configuration", { exact: true });
      await expect(editor).toContainText("fixture-mcp");
      const next = JSON.parse(await editor.innerText());
      delete next.fixture.enabled;
      next.fixture.args = ["--new-option"];
      const calls: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "PUT" || request.method() === "POST") {
          calls.push(new URL(request.url()).pathname);
        }
      });
      await editor.fill(JSON.stringify(next, null, 2));
      await page
        .getByRole("button", { name: "Save MCP configuration", exact: true })
        .click();
      await expect(
        page.getByText("MCP configuration saved and reloaded", { exact: true }),
      ).toBeVisible();
      const saved = await (
        await page.request.get(`${url}/api/resource/config`)
      ).json();
      expect(saved.config.mcp_servers).toEqual(next);
      expect(calls.indexOf("/api/resource/reloadMcp")).toBeGreaterThan(
        calls.indexOf("/api/resource/saveMcp"),
      );
      await editor.fill(
        JSON.stringify({ ...next, draft: { command: "draft" } }, null, 2),
      );
      await page.request.put(`${url}/api/resource/saveMcp`, {
        headers: { origin: url },
        data: { servers: { ...next, external: { command: "desktop" } } },
      });
      await page
        .getByRole("button", { name: "Save MCP configuration", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "MCP configuration changed elsewhere",
      );
      const current = await (
        await page.request.get(`${url}/api/resource/config`)
      ).json();
      expect(current.config.mcp_servers.external.command).toBe("desktop");
      await page.screenshot({ path: "/var/tmp/arura-settings-parity.png" });
    } finally {
      await browser.close();
    }
  },
});
