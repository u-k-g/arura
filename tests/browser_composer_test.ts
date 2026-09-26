import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";
import { Buffer } from "node:buffer";
import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
Deno.test({
  name:
    "Lexical preserves prompt text, completion caret, reference undo, and draft isolation",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    function savedDraft() {
      return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("arura");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<string>((resolve, reject) => {
            const request = db
              .transaction("drafts")
              .objectStore("drafts")
              .get(localStorage.getItem("arura.view") ?? "");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      });
    }
    try {
      await page.goto(
        requireValue(
          Deno.env.get("ARURA_TEST_URL"),
          'Deno.env.get("ARURA_TEST_URL")',
        ),
      );
      await signIn(page, "Composer test");
      const newChat = () =>
        page
          .locator(".sidebar-titlebar, .pinned-divider, .topbar, .nav-footer")
          .getByRole("button", { name: "New conversation", exact: true })
          .first()
          .click();
      await newChat();
      const input = page.getByRole("textbox", {
        name: "Message Hermes",
        exact: true,
      });
      // Completion replaces just the word before the caret, preserving the tail.
      await input.fill("Please /res tail");
      await input.press("Home");
      for (let i = 0; i < 11; i++) await input.press("ArrowRight");
      await expect(
        page.getByRole("option", { name: /research/ }),
      ).toBeVisible();
      await input.press("Tab");
      await page.keyboard.insertText("gardens");
      await expect(input).toHaveText("Please /research gardens tail");
      await expect(input.locator(".composer-reference")).toHaveText(
        "/research",
      );
      // A context reference is one deletion, and Undo restores its exact text.
      const reference = "[Conversation: example — Garden notes]";
      await input.fill(reference);
      await expect(input.locator(".composer-reference")).toHaveText(reference);
      await input.press("End");
      await input.press("Backspace");
      await expect(input).toHaveText("");
      await input.press("ControlOrMeta+z");
      await expect(input.locator(".composer-reference")).toHaveText(reference);
      // Rich clipboard content remains literal prompt text, with no HTML editor state.
      await input.press("ControlOrMeta+a");
      await input.press("Backspace");
      await expect.poll(savedDraft).toBe("");
      const prompt = "  Garden 🌿\n\n**keep this Markdown**\nlast line\n";
      await input.evaluate((element, text) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", text);
        clipboardData.setData("text/html", "<h1>Unwanted formatting</h1>");
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, prompt);
      await expect.poll(savedDraft).toBe(prompt);
      await page.reload();
      await expect(input).toContainText("keep this Markdown");
      // Typing after restoring must retain every newline and Unicode character.
      await input.press("ControlOrMeta+End");
      await page.keyboard.insertText("after reload");
      await expect.poll(savedDraft).toBe(`${prompt}after reload`);
      // IME Enter never submits the partial composition.
      await input.dispatchEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
        keyCode: 229,
      });
      await expect(input).toContainText("after reload");
      await expect(page.locator(".message.user")).toHaveCount(0);
      await newChat();
      await expect(input).toHaveText("");
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveText("");
      const fileChooserPromise = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Upload files" }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles({
        name: "removed-reference.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Do not send this attachment"),
      });
      await expect(input.locator(".composer-reference")).toContainText(
        "removed-reference.txt",
      );
      // Replacing the reference must also exclude the upload from the payload.
      await input.fill("A fresh conversation");
      await input.press("Enter");
      await page.keyboard.insertText("Second line");
      await expect(input).toContainText("Second line");
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: A fresh conversation" }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .locator(".markdown")
          .filter({ hasText: "Received: A fresh conversation" }),
      ).toBeVisible();
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveText("");
      const bootstrap = await (
        await page.request.get(new URL("/api/bootstrap", page.url()).href)
      ).json();
      const auth = await (
        await page.request.get(new URL("/auth/token", page.url()).href)
      ).json();
      const client = new ConvexHttpClient(bootstrap.convexUrl);
      client.setAuth(auth.token);
      const transcript = await client.query(anyApi.workspace.transcript, {
        conversation: await page.evaluate(() =>
          localStorage.getItem("arura.view")
        ),
        pages: 1,
      });
      const sent = transcript.commands.find(
        (item: { kind: string }) => item.kind === "send",
      );
      expect(sent.payload.text).toBe("A fresh conversation\nSecond line");
      expect(sent.payload.attachments).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
});
