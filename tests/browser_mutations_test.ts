import { signIn } from "./sign_in.ts";
import { onceActionDialog } from "./action_dialog.ts";
import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

Deno.test({
  name: "editing an earlier message replaces its continuation; branching preserves the original",
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
      await signIn(page, "Conversation lifecycle test");
      await page
        .locator(".topbar")
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
        localStorage.getItem("arura.view"),
      );
      await page
        .getByRole("button", { name: "Edit and resubmit", exact: true })
        .click();
      await input.fill("Revised instruction");
      void onceActionDialog(page, async (dialog) => {
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
        `${url}/api/download?type=conversation&profile=${encodeURIComponent(
          profile,
        )}&id=${encodeURIComponent(id)}`,
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
  name: "mobile approvals, clarification and secrets resolve across devices without caching the secret",
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
        await signIn(page, "Interaction test");
        await expect(page.getByLabel("Password", { exact: true })).toHaveCount(
          0,
        );
      }
      await a
        .locator(".topbar")
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
      const enqueue = async (text: string) => {
        const id = crypto.randomUUID();
        const row = await client.mutation(anyApi.commands.enqueue, {
          id,
          conversation: key,
          kind: "send",
          payload: { text },
        });
        return row;
      };
      // Historical commands must not hide a prioritized pending message.
      for (let i = 0; i < 32; i++) {
        const id = await enqueue(`Cancelled ${i}`);
        await client.mutation(anyApi.commands.edit, { id, cancel: true });
      }
      const firstNext = await enqueue("First priority");
      const lastNext = await enqueue("Last priority");
      await client.mutation(anyApi.commands.edit, {
        id: firstNext,
        next: true,
      });
      await client.mutation(anyApi.commands.edit, { id: lastNext, next: true });
      await expect(a.locator(".queued-message").first()).toContainText(
        "Last priority",
      );
      await expect(b.locator(".queued-message").first()).toContainText(
        "Last priority",
      );
      const lastRow = b
        .locator(".queued-message")
        .filter({ hasText: "Last priority" });
      void onceActionDialog(b, (dialog) => dialog.accept("Edited priority"));
      await lastRow
        .getByRole("button", { name: "Edit queued message", exact: true })
        .click();
      await expect(a.locator(".queued-message").first()).toContainText(
        "Edited priority",
      );
      await b
        .locator(".queued-message")
        .filter({ hasText: "First priority" })
        .getByRole("button", { name: "Delete queued message", exact: true })
        .click();
      await expect(a.locator(".queue-panel")).not.toContainText(
        "First priority",
      );
      const backlog = [];
      for (let i = 0; i < 105; i++) backlog.push(await enqueue(`Backlog ${i}`));
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
          (command: { payload?: { text?: string } }) =>
            command.payload?.text === "Queued after questions",
        )?.status,
      ).toBe("queued");
      for (const id of backlog) {
        await client.mutation(anyApi.commands.edit, { id, cancel: true });
      }
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
      await expect(
        a.locator(".markdown").filter({ hasText: "Received: Edited priority" }),
      ).toBeVisible();
      const answers = await a.locator(".markdown").allTextContents();
      expect(
        answers.findIndex((text) => text.includes("Received: Edited priority")),
      ).toBeLessThan(
        answers.findIndex((text) =>
          text.includes("Received: Queued after questions"),
        ),
      );
      expect(answers.join("\n")).not.toContain("Received: First priority");
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

Deno.test({
  name: "steering preserves a rejected draft and stopping settles the run before queued work starts",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    try {
      await page.goto(Deno.env.get("ARURA_TEST_URL")!);
      await signIn(page, "Run controls");
      await page
        .locator(".topbar")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      const input = page.getByLabel("Message Hermes", { exact: true });
      await input.fill("ARURA_TEST_CONTROLS");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toBeVisible();
      await input.fill("Reject this correction");
      await page
        .getByRole("button", { name: "Queue message", exact: true })
        .click();
      await page
        .locator(".queued-message")
        .getByRole("button", { name: "Send Now", exact: true })
        .click();
      await expect(page.locator(".queued-message")).toContainText(
        "Reject this correction",
      );
      await page
        .locator(".queued-message")
        .getByRole("button", { name: "Delete queued message", exact: true })
        .click();
      await input.fill("Focus on the garden");
      await page
        .getByRole("button", { name: "Queue message", exact: true })
        .click();
      await page
        .locator(".queued-message")
        .getByRole("button", { name: "Send Now", exact: true })
        .click();
      await expect(page.locator(".queued-message")).toHaveCount(0);
      await expect(input).toHaveText("");
      await input.fill("Continue after stopping");
      await page
        .getByRole("button", { name: "Queue message", exact: true })
        .click();
      await expect(page.locator(".queue-panel")).toContainText(
        "Continue after stopping",
      );
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(
        page.locator(".markdown").filter({
          hasText: "Stopped. Instructions received: Focus on the garden",
        }),
      ).toBeVisible();
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: Continue after stopping" }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeVisible();
    } finally {
      await browser.close();
    }
  },
});
