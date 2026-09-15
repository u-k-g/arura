import { Buffer } from "node:buffer";
import { chromium, expect } from "@playwright/test";

Deno.test({
  name: "retained settings: models, OAuth, memory, bots, and runtime limits",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const url = Deno.env.get("ARURA_TEST_URL")!;
    try {
      await page.goto(url);
      await page
        .getByLabel("Device name", { exact: true })
        .fill("Provider test");
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Models & providers", exact: true })
        .click();
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const auth = page.getByRole("dialog", { name: "Authorize provider" });
      await expect(auth.getByText("TEST-CODE", { exact: true })).toBeVisible();
      await expect(auth.getByText("success", { exact: true })).toBeVisible({
        timeout: 5000,
      });
      await auth
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
      await page
        .getByRole("button", { name: "Auxiliary models", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Change model", exact: true })
        .click();
      await page.getByLabel("Model", { exact: true }).fill("larger-helper");
      let confirmed = false;
      page.once("dialog", async (dialog) => {
        confirmed = dialog.message().includes("helper model cost");
        await dialog.accept();
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      expect(confirmed).toBe(true);
      const aux = await (
        await page.request.get(`${url}/api/resource/auxiliary`)
      ).json();
      expect(aux.tasks[0].model).toBe("larger-helper");
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Models & providers", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Fallback models", exact: true })
        .click();
      await page.getByLabel("Model", { exact: true }).fill("replacement-model");
      await page
        .getByRole("button", { name: "Save fallback order", exact: true })
        .click();
      await expect(
        page.getByText("Fallback models saved", { exact: true }),
      ).toBeVisible();
      const saved = await (
        await page.request.get(`${url}/api/resource/config`)
      ).json();
      expect(saved.config.fallback_providers[0].key_env).toBe("SAVED_KEY");
      expect(saved.config.fallback_model).toBe("legacy-model");
      await page
        .getByLabel("Model", { exact: true })
        .fill("unsaved-local-model");
      const remoteChange = await page.request.put(
        `${url}/api/resource/saveConfig`,
        {
          headers: { origin: url },
          data: {
            config: {
              fallback_providers: [
                {
                  ...saved.config.fallback_providers[0],
                  model: "other-device-model",
                },
              ],
            },
          },
        },
      );
      expect(remoteChange.ok()).toBe(true);
      await expect(
        page.getByText(
          "Fallbacks changed elsewhere. Your unsaved edits are preserved.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
        "unsaved-local-model",
      );
      await page
        .getByRole("button", { name: "Reload fallbacks", exact: true })
        .click();
      await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
        "other-device-model",
      );
      await page
        .getByRole("button", { name: "Disable all fallbacks", exact: true })
        .click();
      await expect(
        page.getByText("Your host also has legacy fallback configuration", {
          exact: false,
        }),
      ).not.toBeVisible();
      const disabled = await (
        await page.request.get(`${url}/api/resource/config`)
      ).json();
      expect(disabled.config.fallback_providers).toEqual([]);
      expect(disabled.config.fallback_model).toBeNull();
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Models & providers", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Mixture of Agents", exact: true })
        .click();
      await page
        .getByLabel("New preset name", { exact: true })
        .fill("Research");
      await page
        .getByRole("button", { name: "Add preset", exact: true })
        .click();
      const reference = page.getByRole("group", {
        name: "Reference 1",
        exact: true,
      });
      await reference.getByLabel("Provider", { exact: true }).fill("fixture");
      await reference
        .getByLabel("Model", { exact: true })
        .fill("research-reference");
      const aggregator = page.getByRole("group", {
        name: "Aggregator",
        exact: true,
      });
      await aggregator.getByLabel("Provider", { exact: true }).fill("fixture");
      await aggregator
        .getByLabel("Model", { exact: true })
        .fill("research-summary");
      await page
        .getByRole("button", { name: "Save mixture presets", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Save mixture presets", exact: true }),
      ).toBeDisabled();
      await page
        .getByLabel("New preset name", { exact: true })
        .fill("Garden research");
      await page
        .getByRole("button", { name: "Rename selected preset", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save mixture presets", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Save mixture presets", exact: true }),
      ).toBeDisabled();
      const mixture = await (
        await page.request.get(`${url}/api/resource/moa`)
      ).json();
      expect(Object.keys(mixture.presets).sort()).toEqual([
        "Garden research",
        "default",
      ]);
      expect(mixture.presets["Garden research"].aggregator.model).toBe(
        "research-summary",
      );
      await page.request.put(`${url}/api/resource/saveConfig`, {
        headers: { origin: url },
        data: {
          config: { moa: { ...mixture, privacy_filter: "Host policy" } },
        },
      });
      await expect(
        page.getByRole("button", {
          name: "Delete selected preset",
          exact: true,
        }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Memory graph", exact: true })
        .click();
      await page
        .getByRole("button", { name: "memory: Garden preference", exact: true })
        .click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByLabel("Content", { exact: true })
        .fill("Prefers native perennial flowers.");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export map snapshot", exact: true })
        .click();
      const download = await downloaded;
      const snapshotPath =
        `/var/tmp/arura-memory-map-${crypto.randomUUID()}.json`;
      await download.saveAs(snapshotPath);
      const snapshot = JSON.parse(await Deno.readTextFile(snapshotPath));
      expect(snapshot.graph.memory).toBeUndefined();
      await page
        .getByLabel("Import map snapshot", { exact: true })
        .setInputFiles(snapshotPath);
      await expect(
        page.getByText("Viewing an imported map.", { exact: false }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "memory: Garden preference", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Edit", exact: true }),
      ).not.toBeVisible();
      const memory = await (
        await page.request.get(`${url}/api/resource/graph`)
      ).json();
      expect(memory.writes).toBe(1);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "MCP servers", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Authorize", exact: true })
        .click();
      const mcp = page.getByRole("dialog", { name: "Authorize fixture" });
      const link = await mcp
        .getByRole("link", { name: "Open authorization page", exact: true })
        .getAttribute("href");
      const state = new URL(link!).searchParams.get("state")!;
      const anonymous = await browser.newContext();
      try {
        expect(
          (
            await anonymous.request.get(
              `${url}/api/mcp/oauth/callback/fixture?state=wrong`,
            )
          ).status(),
        ).toBe(404);
        expect(
          (
            await anonymous.request.get(
              `${url}/api/mcp/oauth/callback/fixture?state=${
                encodeURIComponent(
                  state,
                )
              }&code=fixture-code`,
            )
          ).status(),
        ).toBe(200);
        expect(
          (
            await anonymous.request.get(
              `${url}/api/mcp/oauth/callback/fixture?state=${
                encodeURIComponent(
                  state,
                )
              }&code=fixture-code`,
            )
          ).status(),
        ).toBe(404);
      } finally {
        await anonymous.close();
      }
      await expect(mcp.getByText("Connected", { exact: true })).toBeVisible({
        timeout: 5000,
      });
      await mcp
        .getByRole("button", { name: "Close", exact: true })
        .last()
        .click();
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Profiles & bots", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Backend resources", exact: true })
        .click();
      await page
        .getByLabel("Idle lifetime in seconds", { exact: true })
        .fill("7200");
      await page
        .getByRole("button", { name: "Save runtime settings", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Save runtime settings",
          exact: true,
        }),
      ).toBeDisabled();
      const runtime = await (
        await page.request.get(`${url}/api/resource/config`)
      ).json();
      expect(runtime.config.agent.agent_cache).toEqual({ idle_ttl_secs: 7200 });
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Delegated work", exact: true })
        .click();
      await page.getByLabel("Concurrent subagents", { exact: true }).fill("3");
      await page
        .getByRole("button", { name: "Save runtime settings", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Save runtime settings",
          exact: true,
        }),
      ).toBeDisabled();
      const delegation = await (
        await page.request.get(`${url}/api/resource/config`)
      ).json();
      expect(delegation.config.delegation).toEqual({
        max_concurrent_children: 3,
      });
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Profiles & bots", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await page
        .getByLabel("Display name", { exact: true })
        .fill("Garden assistant");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Garden assistant", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Avatar", exact: true }).click();
      await page.getByLabel("Upload avatar", { exact: true }).setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ2kAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await expect(
        page.getByAltText("Avatar for default", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page.getByRole("button", { name: "Chat", exact: true }).click();
      await expect(
        page.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      const canonical = await page.evaluate(() =>
        localStorage.getItem("arura.view")
      );
      const roster = await (
        await page.request.get(`${url}/api/resource/profileRoster`)
      ).json();
      expect(JSON.parse(canonical!)[1]).toBe(
        roster.profiles[0].canonical_session.resolved_id,
      );
      expect(roster.profiles[0].ui_meta["hermes-bots"].imageKind).toBe("photo");
      await page
        .locator(".topbar")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .not.toBe(canonical);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Profiles & bots", exact: true })
        .click();
      await page.getByRole("button", { name: "Chat", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .toBe(canonical);
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name:
    "desktop and mobile browsers: stream, archive, offline reopen, and revoke",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const desktop = await browser.newContext({
      viewport: { width: 1365, height: 900 },
    });
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const a = await desktop.newPage(),
      b = await mobile.newPage();
    const errors: string[] = [];
    a.on("pageerror", (e) => errors.push(e.message));
    b.on("pageerror", (e) => errors.push(e.message));
    const url = Deno.env.get("ARURA_TEST_URL")!;
    const suffix = crypto.randomUUID().slice(0, 8);
    try {
      for (
        const [page, name] of [
          [a, "Desktop"],
          [b, "Phone"],
        ] as const
      ) {
        await page.goto(url);
        await page
          .getByLabel("Device name", { exact: true })
          .fill(`${name} ${suffix}`);
        await page
          .getByLabel("Authorization code", { exact: true })
          .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
        await page
          .getByRole("button", { name: "Authorize this device", exact: true })
          .click();
        await expect(page.locator(".app-shell")).toBeVisible({
          timeout: 15000,
        });
      }
      await a
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .first()
        .click();
      await b
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await b
        .getByRole("dialog")
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .first()
        .click();
      const message = `Two-device message ${suffix}`;
      await b.getByLabel("Message Hermes", { exact: true }).fill(message);
      await b
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        a.locator(".markdown").filter({ hasText: `Received: ${message}` }),
      ).toBeVisible({ timeout: 15000 });
      const found = await a.request.get(
        `${url}/api/search?q=${encodeURIComponent(message)}`,
      );
      const searchBody = await found.text();
      expect(searchBody.includes("PRIVATE_REASONING_SEARCH_SNIPPET")).toBe(
        false,
      );
      await a
        .getByRole("button", { name: "Search conversations", exact: true })
        .click();
      await a
        .getByPlaceholder("Search conversations and actions")
        .fill(message);
      await a
        .getByRole("dialog", { name: "Find anything" })
        .getByRole("option", { name: /^Fixture conversation\b/ })
        .click();
      await expect(
        b.locator(".markdown").filter({ hasText: `Received: ${message}` }),
      ).toBeVisible({ timeout: 15000 });
      expect(await a.locator("body").textContent()).not.toContain(
        "PRIVATE REASONING",
      );
      await expect(b.locator(".work-summary[open]")).toHaveCount(0);
      await a.getByRole("button", { name: "Model", exact: true }).click();
      await a
        .getByRole("button", { name: "Customize model list", exact: true })
        .click();
      await a
        .getByRole("checkbox", {
          name: "fixture-alternative · Fixture provider",
          exact: true,
        })
        .uncheck();
      await b.getByRole("button", { name: "Model", exact: true }).click();
      await expect(
        b.getByRole("button", {
          name: "fixture-alternative · Fixture provider",
          exact: true,
        }),
      ).toHaveCount(0);
      await b
        .getByRole("button", { name: "Customize model list", exact: true })
        .click();
      await expect(
        b.getByRole("checkbox", {
          name: "fixture-alternative · Fixture provider",
          exact: true,
        }),
      ).not.toBeChecked();
      await b
        .getByRole("checkbox", {
          name: "fixture-alternative · Fixture provider",
          exact: true,
        })
        .check();
      await expect(
        a.getByRole("checkbox", {
          name: "fixture-alternative · Fixture provider",
          exact: true,
        }),
      ).toBeChecked();
      await b.getByRole("button", { name: "Close", exact: true }).click();
      await a
        .getByRole("button", { name: "Done customizing", exact: true })
        .click();
      await a
        .getByRole("button", {
          name: "fixture-alternative · Fixture provider",
          exact: true,
        })
        .click();
      await expect(
        a.getByRole("dialog", { name: "Choose a model" }),
      ).toHaveCount(0);
      await a.getByLabel("More composer actions", { exact: true }).click();
      await a.getByRole("button", { name: "Context", exact: true }).click();
      await expect(
        a.getByRole("dialog", { name: "Context usage" }),
      ).toContainText("2,000");
      await a.getByRole("button", { name: "Close", exact: true }).click();
      await a.getByLabel("Message Hermes", { exact: true }).fill("/res");
      await expect(
        a.getByRole("listbox", { name: "Commands and skills" }),
      ).toBeVisible();
      await a.getByLabel("Message Hermes", { exact: true }).press("Tab");
      await expect(a.getByLabel("Message Hermes", { exact: true })).toHaveText(
        "/research ",
      );
      await a.getByLabel("Message Hermes", { exact: true }).fill("");
      await a
        .getByRole("button", {
          name: "Actions for Fixture conversation",
          exact: true,
        })
        .first()
        .click();
      await a
        .getByRole("button", { name: "Toggle Essentials", exact: true })
        .click();
      await b
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await expect(
        b
          .locator("dialog .essentials")
          .getByRole("button", { name: "Fixture conversation", exact: true }),
      ).toBeVisible();
      await b.getByRole("button", { name: "Close", exact: true }).click();
      await a
        .getByRole("button", { name: "Archive conversation", exact: true })
        .click();
      await b
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await b
        .getByRole("dialog")
        .getByRole("button", { name: "Archived", exact: true })
        .click();
      await expect(
        b.getByRole("dialog").getByRole("button", {
          name: "Unarchive Fixture conversation",
          exact: true,
        }),
      ).toBeVisible();
      await b
        .getByRole("dialog")
        .getByRole("button", {
          name: "Unarchive Fixture conversation",
          exact: true,
        })
        .click();
      await expect(
        a
          .locator(".essentials button")
          .filter({ hasText: "Fixture conversation" }),
      ).toHaveCount(0);
      await expect(
        a.getByRole("button", {
          name: "Actions for Fixture conversation",
          exact: true,
        }),
      ).toBeVisible();
      await b.getByRole("button", { name: "Close", exact: true }).click();
      await a.screenshot({ path: "/var/tmp/arura-desktop-conversation.png" });
      await b.screenshot({ path: "/var/tmp/arura-mobile-conversation.png" });
      await b.setViewportSize({ width: 844, height: 390 });
      await expect(b.locator(".desktop-navigation")).toBeHidden();
      await expect(
        b.getByRole("button", { name: "Open conversations", exact: true }),
      ).toBeVisible();
      const landscapeInput = b.getByLabel("Message Hermes", { exact: true });
      await landscapeInput.fill("Landscape draft");
      await landscapeInput.press("Enter");
      await expect(landscapeInput).toHaveText("Landscape draft");
      await expect(landscapeInput.locator("br")).not.toHaveCount(0);
      await b.setViewportSize({ width: 390, height: 844 });
      await b
        .getByLabel("Message Hermes", { exact: true })
        .fill("An offline draft");
      await b.evaluate(() => navigator.serviceWorker.ready);
      await mobile.setOffline(true);
      await b.reload();
      await expect(b.getByLabel("Message Hermes", { exact: true })).toHaveText(
        "An offline draft",
        { timeout: 10000 },
      );
      await mobile.setOffline(false);
      await b.reload();
      await expect(b.getByLabel("Message Hermes", { exact: true })).toHaveText(
        "An offline draft",
      );
      await a.getByRole("button", { name: "Files", exact: true }).click();
      await a
        .locator(".resource-card")
        .filter({ hasText: "large.txt" })
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await expect(
        a.getByRole("button", { name: "Save", exact: true }),
      ).toBeDisabled();
      await a.getByRole("button", { name: "Close", exact: true }).click();
      await a
        .locator(".resource-card")
        .filter({ hasText: "notes.md" })
        .getByRole("button", { name: "Open", exact: true })
        .click();
      const editor = a.getByLabel("File content", { exact: true });
      await expect(editor).toContainText("Original host content");
      await editor.click();
      await a.keyboard.press("ControlOrMeta+a");
      await a.keyboard.insertText("# Revised notes\n\nSaved through Arura.");
      await a.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        a.getByRole("status").filter({ hasText: "File saved" }),
      ).toBeVisible();
      await a.getByRole("button", { name: "Close", exact: true }).click();
      await a
        .locator(".resource-card")
        .filter({ hasText: "notes.md" })
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await expect(editor).toContainText("Saved through Arura.");
      await editor.click();
      await a.keyboard.press("ControlOrMeta+a");
      await a
        .getByRole("button", { name: "Attach selection", exact: true })
        .click();
      await a
        .getByRole("dialog", { name: "Add selection to a conversation" })
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .first()
        .click();
      await expect(a.getByLabel("Message Hermes", { exact: true })).toHaveText(
        /Saved through Arura/,
      );
      await a.getByRole("button", { name: "Files", exact: true }).click();
      await a
        .getByRole("button", { name: "Generated files", exact: true })
        .click();
      await expect(
        a.locator(".resource-card").filter({ hasText: "notes.md" }).first(),
      ).toBeVisible({ timeout: 15000 });
      await a.getByRole("button", { name: "Settings", exact: true }).click();
      await a.getByRole("button", { name: "Schedules", exact: true }).click();
      await a
        .getByRole("button", { name: "Automation blueprints", exact: true })
        .click();
      await a
        .getByRole("dialog", { name: "Automation blueprints" })
        .getByRole("button", { name: /Daily note/ })
        .click();
      await a.getByLabel("Topic", { exact: true }).fill("Garden notes");
      await a
        .getByRole("button", { name: "Create schedule", exact: true })
        .click();
      await expect(
        a.locator(".resource-card").filter({ hasText: "Daily note" }),
      ).toBeVisible();
      await a
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await a
        .getByRole("button", { name: "Access & devices", exact: false })
        .click();
      const phone = a
        .locator(".device-card")
        .filter({ hasText: `Phone ${suffix}` });
      a.once("dialog", (dialog) => dialog.accept());
      await phone.getByRole("button", { name: "Revoke", exact: true }).click();
      await expect(
        b.getByRole("button", { name: "Authorize this device", exact: true }),
      ).toBeVisible({ timeout: 10000 });
      expect((await b.request.get(`${url}/auth/token`)).status()).toBe(401);
      expect(errors).toEqual([]);
      await a.screenshot({ path: "/var/tmp/arura-desktop.png" });
      await b.screenshot({ path: "/var/tmp/arura-mobile.png" });
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "storage-disabled browsers stay usable and keep drafts while open",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      });
      Object.defineProperty(window, "indexedDB", {
        get() {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(Deno.env.get("ARURA_TEST_URL")!);
      await page
        .getByLabel("Device name", { exact: true })
        .fill("Storage-disabled browser");
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .first()
        .click();
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("Keep this draft in memory");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Storage & offline", exact: false })
        .click();
      await expect(
        page.getByText("This browser cannot save local data.", {
          exact: false,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .first()
        .click();
      await expect(
        page.getByLabel("Message Hermes", { exact: true }),
      ).toHaveText("Keep this draft in memory");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
});
