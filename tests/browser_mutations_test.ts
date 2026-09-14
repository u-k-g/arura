import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

Deno.test({
  name:
    "editing an earlier message replaces its continuation; branching preserves the original",
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
        .fill("Conversation lifecycle test");
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      await page
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      const input = page.getByLabel("Message Hermes", { exact: true });
      await input.fill("Original instruction");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: Original instruction" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeVisible();
      const originalKey = await page.evaluate(() =>
        localStorage.getItem("arura.view")
      );
      await page
        .getByRole("button", { name: "Edit and resubmit", exact: true })
        .click();
      await input.fill("Revised instruction");
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain(
          "Replace the conversation after this message?",
        );
        await dialog.accept();
      });
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: Revised instruction" }),
      ).toBeVisible();
      await expect(
        page.locator(".markdown").filter({ hasText: "Original instruction" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeVisible();
      await page
        .locator("article")
        .filter({
          has: page
            .locator(".markdown")
            .filter({ hasText: "Received: Revised instruction" }),
        })
        .getByRole("button", { name: "Branch conversation", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("arura.view")))
        .not.toBe(originalKey);
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: Revised instruction" }),
      ).toBeVisible();
      await input.fill("Only in the branch");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: Only in the branch" }),
      ).toBeVisible();
      const [profile, id] = JSON.parse(originalKey!);
      const original = await page.request.get(
        `${url}/api/download?type=conversation&profile=${
          encodeURIComponent(profile)
        }&id=${encodeURIComponent(id)}`,
      );
      expect(original.ok()).toBe(true);
      const exported = await original.json();
      expect(
        exported.messages
          .map((message: { text: string }) => message.text)
          .join("\n"),
      ).toContain("Revised instruction");
      expect(JSON.stringify(exported)).not.toContain("Only in the branch");
      expect(JSON.stringify(exported)).not.toContain("Original instruction");
    } catch (error) {
      await Deno.writeTextFile(
        "/var/tmp/arura-edit-branch-failure.txt",
        await page.locator("body").innerText(),
      );
      throw error;
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name:
    "mobile approvals, clarification and secrets resolve across devices without caching the secret",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const desktop = await browser.newContext();
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const a = await desktop.newPage(),
      b = await mobile.newPage();
    const url = Deno.env.get("ARURA_TEST_URL")!;
    try {
      for (const page of [a, b]) {
        await page.goto(url);
        await page
          .getByLabel("Device name", { exact: true })
          .fill("Interaction test");
        await page
          .getByLabel("Authorization code", { exact: true })
          .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
        await page
          .getByRole("button", { name: "Authorize this device", exact: true })
          .click();
        await expect(
          page.getByLabel("Authorization code", { exact: true }),
        ).toHaveCount(0);
      }
      await a
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      await expect(
        a.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      const key = await a.evaluate(() => localStorage.getItem("arura.view"));
      const bootstrap = await (
        await a.request.get(`${url}/api/bootstrap`)
      ).json();
      const auth = await (await a.request.get(`${url}/auth/token`)).json();
      const client = new ConvexHttpClient(bootstrap.convexUrl);
      client.setAuth(auth.token);
      await b.evaluate((key) => localStorage.setItem("arura.view", key!), key);
      await b.reload();
      await expect(
        b.getByLabel("Message Hermes", { exact: true }),
      ).toBeVisible();
      await a
        .getByLabel("Message Hermes", { exact: true })
        .fill("ARURA_TEST_INTERACTIONS");
      await a
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        a.getByRole("button", { name: "Allow once", exact: true }),
      ).toBeVisible();
      await b.getByRole("button", { name: "Allow once", exact: true }).click();
      await expect(
        a.getByRole("button", { name: "Allow once", exact: true }),
      ).toHaveCount(0);
      await a
        .getByLabel("Message Hermes", { exact: true })
        .fill("Queued after questions");
      await a
        .getByRole("button", { name: "Queue message", exact: true })
        .click();
      const expiredApprovalId = crypto.randomUUID();
      await client.mutation(anyApi.commands.enqueue, {
        id: expiredApprovalId,
        kind: "rpc",
        conversation: key,
        payload: {
          method: "approval.respond",
          params: { request_id: crypto.randomUUID(), choice: "once" },
        },
      });
      await expect
        .poll(
          async () =>
            (
              await client.query(anyApi.commands.result, {
                id: expiredApprovalId,
              })
            )?.status,
        )
        .toBe("error");
      // Give the next dispatcher pass a chance to run: a failed control must not release the send queue.
      await a.waitForTimeout(1100);
      const pending = await client.query(anyApi.workspace.transcript, {
        conversation: key,
        pages: 1,
      });
      expect(
        pending.commands.find(
          (command: any) => command.payload?.text === "Queued after questions",
        )?.status,
      ).toBe("queued");
      await a.getByLabel("Your answer", { exact: true }).fill("Blue");
      await a
        .locator(".interaction")
        .filter({ hasText: "Which garden color?" })
        .getByRole("button", { name: "Answer", exact: true })
        .click();
      const flowers = b.getByRole("group", {
        name: "Which flowers?",
        exact: true,
      });
      const draftLocation = a
        .getByRole("group", { name: "Where should they grow?", exact: true })
        .getByLabel("Your answer", { exact: true });
      await draftLocation.fill("Unsaved location draft");
      await flowers
        .getByRole("checkbox", { name: "Iris", exact: true })
        .check();
      await flowers
        .getByRole("checkbox", { name: "Lily", exact: true })
        .check();
      await flowers
        .getByRole("button", { name: "Confirm answer", exact: true })
        .click();
      await expect(
        a
          .getByRole("group", { name: "Which flowers?", exact: true })
          .getByRole("status"),
      ).toContainText("Answer saved");
      await expect(draftLocation).toHaveValue("Unsaved location draft");
      await a.reload();
      const restored = a.getByRole("group", {
        name: "Which flowers?",
        exact: true,
      });
      await expect(
        restored.getByRole("checkbox", { name: "Iris", exact: true }),
      ).toBeChecked();
      await expect(
        restored.getByRole("checkbox", { name: "Lily", exact: true }),
      ).toBeChecked();
      const location = a.getByRole("group", {
        name: "Where should they grow?",
        exact: true,
      });
      await location
        .getByLabel("Your answer", { exact: true })
        .fill("By the pond");
      await location
        .getByRole("button", { name: "Confirm answer", exact: true })
        .click();
      await expect(
        b.getByRole("group", { name: "Which flowers?", exact: true }),
      ).toHaveCount(0);
      const secret = `PRIVATE_VERIFICATION_${crypto.randomUUID()}`;
      await b
        .getByLabel("Secret or verification code", { exact: true })
        .fill(secret);
      await b
        .locator(".interaction")
        .filter({ hasText: "Enter the fixture verification code" })
        .getByRole("button", { name: "Answer", exact: true })
        .click();
      await expect(
        a.getByLabel("Secret or verification code", { exact: true }),
      ).toHaveCount(0);
      await expect(
        a
          .locator(".markdown")
          .filter({ hasText: "Received: ARURA_TEST_INTERACTIONS" }),
      ).toBeVisible();
      await expect(
        a
          .locator(".markdown")
          .filter({ hasText: "Received: Queued after questions" }),
      ).toBeVisible({ timeout: 10000 });
      const transcript = await client.query(anyApi.workspace.transcript, {
        conversation: key,
        pages: 1,
      });
      expect(JSON.stringify(transcript)).not.toContain(secret);
      const expired = await b.request.post(`${url}/api/respond`, {
        headers: { origin: url },
        data: {
          conversation: key,
          requestId: crypto.randomUUID(),
          value: secret,
        },
      });
      expect(expired.status()).toBe(409);
      expect((await expired.json()).error).toContain(
        "expired or was already answered",
      );
      const cached = await b.evaluate(async () => {
        const request = indexedDB.open("arura");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await Promise.all(
            ["cache", "drafts"].map(
              (store) =>
                new Promise((resolve, reject) => {
                  const read = db
                    .transaction(store)
                    .objectStore(store)
                    .getAll();
                  read.onsuccess = () => resolve(read.result);
                  read.onerror = () => reject(read.error);
                }),
            ),
          );
        } finally {
          db.close();
        }
      });
      expect(JSON.stringify(cached)).not.toContain(secret);
    } finally {
      await browser.close();
    }
  },
});
