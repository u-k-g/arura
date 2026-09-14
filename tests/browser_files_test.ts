import { Buffer } from "node:buffer";
import { chromium, expect, type Page } from "@playwright/test";

Deno.test({
  name:
    "uploads round-trip through the host and concurrent file edits preserve the losing draft",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const url = Deno.env.get("ARURA_TEST_URL")!;
    async function device(name: string) {
      const page = await browser.newPage();
      await page.goto(url);
      await page.getByLabel("Device name", { exact: true }).fill(name);
      await page
        .getByLabel("Authorization code", { exact: true })
        .fill(Deno.env.get("ARURA_TEST_ACCESS_KEY")!);
      await page
        .getByRole("button", { name: "Authorize this device", exact: true })
        .click();
      return page;
    }
    try {
      const a = await device("Files desktop"),
        b = await device("Files second device");
      await a
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
      const path = (await input.innerText()).match(
        /\[Attached file: (.+)\]/,
      )![1];
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
              Uint8Array.from(
                atob(data),
                (character) => character.charCodeAt(0),
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
      const imagePath = (await input.innerText()).match(
        /\[Attached file: (.+pasted\.png)\]/,
      )![1];
      const imageDownload = await b.request.get(
        `${url}/api/download?${new URLSearchParams({ path: imagePath })}`,
      );
      expect(imageDownload.status()).toBe(200);
      expect((await imageDownload.body()).toString("base64")).toBe(png);
      const edit = async function (page: Page, text: string) {
        await page.getByRole("button", { name: "Files", exact: true }).click();
        await page
          .locator(".resource-card")
          .filter({ hasText: name })
          .getByRole("button", { name: "Open", exact: true })
          .click();
        const editor = page.getByLabel("File content", { exact: true });
        await expect(editor).toContainText(content);
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText(text);
      };
      await edit(a, "First device revision");
      await edit(b, "Second device draft");
      await a.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        a.getByRole("status").filter({ hasText: "File saved" }),
      ).toBeVisible();
      const conflict = b.waitForEvent("dialog");
      await b.getByRole("button", { name: "Save", exact: true }).click();
      const dialog = await conflict;
      expect(dialog.message()).toContain("changed on the host");
      await dialog.dismiss();
      await expect(b.getByLabel("File content", { exact: true })).toContainText(
        "Second device draft",
      );
      expect(
        await (
          await b.request.get(
            `${url}/api/download?${new URLSearchParams({ path })}`,
          )
        ).text(),
      ).toBe("First device revision");
      // Simultaneous requests cannot both overwrite the same version.
      const save = (page: Page, text: string) =>
        page.request.post(`${url}/api/resource/saveFile`, {
          headers: { origin: url },
          data: {
            path,
            content: text,
            expectedContent: "First device revision",
          },
        });
      const responses = await Promise.all([
        save(a, "Concurrent A"),
        save(b, "Concurrent B"),
      ]);
      expect(responses.map((response) => response.status()).sort()).toEqual([
        200,
        409,
      ]);
      const stored = await (
        await a.request.get(
          `${url}/api/download?${new URLSearchParams({ path })}`,
        )
      ).text();
      expect(["Concurrent A", "Concurrent B"]).toContain(stored);
    } finally {
      await browser.close();
    }
  },
});
