import { requireValue } from "./require_value.ts";
import { openSettings, signIn } from "./sign_in.ts";
import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { identity } from "../server/identity.ts";
Deno.test({
  name:
    "profile rename preserves folders, open conversations and drafts; clones and deletion remain independent",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = requireValue(
      Deno.env.get("ARURA_TEST_URL"),
      'Deno.env.get("ARURA_TEST_URL")',
    );
    const cleanup: string[] = [];
    try {
      const a = await browser.newPage(),
        b = await browser.newPage();
      for (const page of [a, b]) {
        await page.goto(url);
        await signIn(page, "Profile lifecycle");
      }
      const write = async (
        op: string,
        method: string,
        data: unknown,
        id?: string,
      ) => {
        const response = await a.request.fetch(
          `${url}/api/resource/${op}${
            id ? `?id=${encodeURIComponent(id)}` : ""
          }`,
          { method, headers: { origin: url }, data },
        );
        expect(response.ok(), await response.text()).toBe(true);
        return response.json();
      };
      const original = `profile-${crypto.randomUUID()}`,
        renamed = `${original}-renamed`,
        clone = `${original}-clone`;
      cleanup.push(original, renamed, clone);
      await write("createProfile", "POST", { name: original });
      await write(
        "saveSoul",
        "PUT",
        { content: "Prefer concise garden advice." },
        original,
      );
      await write("createProfile", "POST", {
        name: clone,
        clone_from: original,
      });
      const soul = await a.request.get(`${url}/api/resource/soul?id=${clone}`);
      expect((await soul.json()).content).toBe("Prefer concise garden advice.");
      await openSettings(a);
      await a
        .getByRole("button", { name: "Profiles & bots", exact: true })
        .click();
      await a
        .getByRole("navigation", { name: "Profiles & bots list" })
        .getByRole("button", { name: original, exact: true })
        .click();
      await a
        .locator(".resource-card")
        .filter({
          has: a.getByRole("heading", { name: original, exact: true }),
        })
        .getByRole("button", { name: "Chat", exact: true })
        .click();
      await expect(
        a.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      const key = requireValue(
        await a.evaluate(() => localStorage.getItem("arura.view")),
        '(await a.evaluate(() => localStorage.getItem("arura.view")))',
      );
      const bootstrap = await (
        await a.request.get(`${url}/api/bootstrap`)
      ).json();
      const auth = await (await a.request.get(`${url}/auth/token`)).json();
      const client = new ConvexHttpClient(bootstrap.convexUrl);
      client.setAuth(auth.token);
      await client.mutation(anyApi.workspace.folder, { name: original });
      const folder = (
        await client.query(anyApi.workspace.overview, {})
      ).folders.find((f: Record<string, unknown>) => f.name === original);
      await client.mutation(anyApi.workspace.move, {
        key,
        section: "pinned",
        folderId: folder._id,
      });
      await b.evaluate((key) => localStorage.setItem("arura.view", key), key);
      await b.reload();
      await b
        .getByLabel("Message Hermes", { exact: true })
        .fill("Draft stays with the renamed profile");
      // Finish the local draft write before triggering migration from the other device.
      await expect(b.getByLabel("Message Hermes", { exact: true })).toHaveText(
        "Draft stays with the renamed profile",
      );
      await write(
        "editProfile",
        "PATCH",
        { new_name: renamed.toUpperCase() },
        original,
      );
      const newKey = JSON.stringify([renamed, JSON.parse(key)[1]]);
      expect((await client.query(anyApi.workspace.byKey, { key }))?.key).toBe(
        newKey,
      );
      await expect
        .poll(() => b.evaluate(() => localStorage.getItem("arura.view")))
        .toBe(newKey);
      await expect(b.getByLabel("Message Hermes", { exact: true })).toHaveText(
        "Draft stays with the renamed profile",
      );
      const moved = await client.query(anyApi.workspace.byKey, { key });
      expect(moved.key).toBe(newKey);
      expect(moved.folderId).toBe(folder._id);
      expect(moved.section).toBe("pinned");
      await write("editProfile", "PATCH", { new_name: original }, renamed);
      await expect
        .poll(() => b.evaluate(() => localStorage.getItem("arura.view")))
        .toBe(key);
      expect(
        (await client.query(anyApi.workspace.byKey, { key: newKey })).key,
      ).toBe(key);
      // Recover a rename whose host-side success was never acknowledged by the request handler.
      const adapter = new ConvexHttpClient(bootstrap.convexUrl);
      adapter.setAuth(await (await identity()).sign("arura:adapter"));
      await adapter.mutation(anyApi.profiles.prepareRename, {
        from: original,
        to: renamed,
      });
      const sourceRename = await fetch(
        `${Deno.env.get("HERMES_URL")}/api/profiles/${original}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ new_name: renamed }),
        },
      );
      expect(sourceRename.ok).toBe(true);
      await sourceRename.body?.cancel();
      await expect
        .poll(() => b.evaluate(() => localStorage.getItem("arura.view")))
        .toBe(newKey);
      await expect
        .poll(
          async () =>
            (await adapter.query(anyApi.profiles.pendingRenames, {})).length,
        )
        .toBe(0);
      expect(
        (await client.query(anyApi.workspace.byKey, { key })).folderId,
      ).toBe(folder._id);
      await write("editProfile", "PATCH", { new_name: original }, renamed);
      await write("deleteProfile", "DELETE", {}, original);
      await expect
        .poll(() => client.query(anyApi.workspace.byKey, { key }))
        .toBe(null);
      const roster = await (
        await a.request.get(`${url}/api/resource/profileRoster`)
      ).json();
      expect(
        roster.profiles.some((p: Record<string, unknown>) => p.name === clone),
      ).toBe(true);
      await write("deleteProfile", "DELETE", {}, clone);
      await client.mutation(anyApi.workspace.folder, {
        id: folder._id,
        remove: true,
      });
    } finally {
      const context = browser.contexts()[0];
      for (const name of cleanup) {
        await context?.request
          .delete(
            `${url}/api/resource/deleteProfile?id=${encodeURIComponent(name)}`,
            { headers: { origin: url }, data: {} },
          )
          .catch(() => {});
      }
      await browser.close();
    }
  },
});
