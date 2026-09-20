import { requireValue } from "./require_value.ts";
import { signIn } from "./sign_in.ts";
import { Buffer } from "node:buffer";
import { chromium, expect } from "@playwright/test";
Deno.test({
  name: "file and pasted-image uploads round-trip through the host",
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
    async function device(name: string) {
      const page = await browser.newPage();
      await page.goto(url);
      await signIn(page, name);
      return page;
    }
    try {
      const a = await device("Files desktop"),
        b = await device("Files second device");
      await a
        .locator(".sidebar-titlebar, .topbar, .nav-footer")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      const name = `upload-${crypto.randomUUID()}.txt`;
      const content = "Uploaded notes, before either device edits them.";
      await a.locator('input[type="file"]').setInputFiles({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(content),
      });
      const input = a.getByLabel("Message Hermes", { exact: true });
      await expect(input).toHaveText(/Attached file:/);
      const path = requireValue(
        (await input.innerText()).match(/\[Attached file: (.+)\]/),
        "(await input.innerText()).match(\n        /\\[Attached file: (.+)\\]/,\n      )",
      )[1];
      const downloaded = await b.request.get(
        `${url}/api/download?${new URLSearchParams({ path })}`,
      );
      expect(downloaded.status()).toBe(200);
      expect(await downloaded.text()).toBe(content);
      expect(downloaded.headers()["x-content-type-options"]).toBe("nosniff");
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ2kAAAAASUVORK5CYII=";
      await input.evaluate((element, data) => {
        const clipboardData = new DataTransfer();
        clipboardData.items.add(
          new File(
            [
              Uint8Array.from(atob(data), (character) =>
                character.charCodeAt(0),
              ),
            ],
            "pasted.png",
            { type: "image/png" },
          ),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData, bubbles: true }),
        );
      }, png);
      await expect(input).toHaveText(/pasted\.png/);
      const imagePath = requireValue(
        (await input.innerText()).match(/\[Attached file: (.+pasted\.png)\]/),
        "(await input.innerText()).match(\n        /\\[Attached file: (.+pasted\\.png)\\]/,\n      )",
      )[1];
      const imageDownload = await b.request.get(
        `${url}/api/download?${new URLSearchParams({ path: imagePath })}`,
      );
      expect(imageDownload.status()).toBe(200);
      expect((await imageDownload.body()).toString("base64")).toBe(png);
    } finally {
      await browser.close();
    }
  },
});
