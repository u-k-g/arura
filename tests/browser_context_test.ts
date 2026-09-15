import { chromium, expect } from "@playwright/test";

Deno.test({
  name:
    "attached context stays out of messages, copied text and editing while Hermes retains it",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const source = `${Deno.env.get("HERMES_URL")}/api/sessions/fixture-chat`;
    const original = await (
      await fetch(`${source}/messages?limit=500&include_compacted=true`)
    ).json();
    const patch = async (messages: unknown) => {
      const response = await fetch(source, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      expect(response.ok).toBe(true);
    };
    const prompt = "Summarize @url:https://example.com/article";
    const raw =
      `${prompt}\n\n--- Attached Context ---\n\n@url:https://example.com/article\nINTERNAL_FETCHED_PAGE_TEXT\n\n--- Context Warnings ---\nINTERNAL_CONTEXT_WARNING`;
    try {
      await patch([
        { id: 901, role: "user", content: raw },
        { id: 902, role: "assistant", content: "A short summary." },
      ]);
      await page.goto(Deno.env.get("ARURA_TEST_URL")!);
      await page
        .getByLabel("Device name", { exact: true })
        .fill("Context test");
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Fixture conversation", exact: true })
        .click();
      const message = page.locator(".message.user").first();
      await expect(message).toContainText(prompt);
      await expect(message).not.toContainText("Attached Context");
      await expect(message).not.toContainText("INTERNAL_");
      await message.hover();
      await message
        .getByRole("button", { name: "Copy message", exact: true })
        .click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        prompt,
      );
      await message
        .getByRole("button", { name: "Edit and resubmit", exact: true })
        .click();
      const composer = page.getByRole("textbox", {
        name: "Message Hermes",
        exact: true,
      });
      await expect(composer).toContainText(prompt);
      await expect(composer).not.toContainText("INTERNAL_");
      const saved = await (await fetch(`${source}/messages?limit=500`)).json();
      expect(saved.messages[0].content).toBe(raw);
      await page.reload();
      await expect(page.locator(".message.user").first()).not.toContainText(
        "Attached Context",
      );
    } finally {
      await patch(original.messages);
      await browser.close();
    }
  },
});
