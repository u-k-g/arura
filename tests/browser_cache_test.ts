import { chromium, expect } from "@playwright/test";

Deno.test({
  name: "cache upgrade retains drafts and quota recovery evicts replaceable content",
  ignore: !Deno.env.get("ARURA_TEST_URL"),
  async fn() {
    const browser = await chromium.launch({
      headless: true,
      executablePath: Deno.env.get("ARURA_BROWSER_EXECUTABLE"),
    });
    const page = await browser.newPage();
    const url = Deno.env.get("ARURA_TEST_URL")!;
    try {
      await page.route(url + "/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<html><body>Cache migration fixture</body></html>",
        }),
      );
      await page.goto(url);
      const authorized = await page.request.post(`${url}/auth/login`, {
        headers: { origin: url },
        data: {
          name: "Cache pressure",
          code: Deno.env.get("ARURA_TEST_ACCESS_KEY")!,
        },
      });
      expect(authorized.ok()).toBe(true);
      await page.evaluate(async () => {
        const request = indexedDB.open("arura", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("cache");
          request.result.createObjectStore("drafts");
        };
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction(["cache", "drafts"], "readwrite");
        tx.objectStore("drafts").put("A legacy unsent draft", "legacy-key");
        tx.objectStore("cache").put(
          { text: "Rebuildable old history" },
          "chat:old",
        );
        tx.objectStore("cache").put(
          [{ path: "/fixture/draft.txt" }],
          "attachments:legacy-key",
        );
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      });
      await page.unroute(url + "/");
      await page.reload();
      await expect(
        page
          .locator(".topbar")
          .getByRole("button", { name: "New conversation", exact: true })
          .first(),
      ).toBeVisible();
      const migrated = await page.evaluate(async () => {
        const request = indexedDB.open("arura");
        const db = await new Promise<IDBDatabase>((resolve) => {
          request.onsuccess = () => resolve(request.result);
        });
        const read = db
          .transaction("drafts")
          .objectStore("drafts")
          .get("legacy-key");
        const draft = await new Promise((resolve) => {
          read.onsuccess = () => resolve(read.result);
        });
        const value = {
          version: db.version,
          draft,
          metadata: db.objectStoreNames.contains("cacheMetadata"),
        };
        db.close();
        return value;
      });
      expect(migrated).toEqual({
        version: 2,
        draft: "A legacy unsent draft",
        metadata: true,
      });
      await page
        .locator(".topbar")
        .getByRole("button", { name: "New conversation", exact: true })
        .first()
        .click();
      // Add replaceable content, then inject one quota failure on a real draft write.
      await page.evaluate(async () => {
        const request = indexedDB.open("arura");
        const db = await new Promise<IDBDatabase>((resolve) => {
          request.onsuccess = () => resolve(request.result);
        });
        const tx = db.transaction(["cache", "cacheMetadata"], "readwrite");
        tx.objectStore("cache").put({ text: "Old history" }, "chat:old");
        tx.objectStore("cacheMetadata").put({ touchedAt: 0 }, "chat:old");
        tx.objectStore("cache").put(
          [{ path: "/fixture/draft.txt" }],
          "attachments:protected",
        );
        tx.objectStore("cacheMetadata").put(
          { touchedAt: 0 },
          "attachments:protected",
        );
        await new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
        });
        db.close();
        const put = IDBObjectStore.prototype.put;
        let failed = false;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === "drafts" && !failed) {
            failed = true;
            throw new DOMException(
              "Simulated quota exhaustion",
              "QuotaExceededError",
            );
          }
          return put.apply(this, args);
        };
      });
      await page
        .getByLabel("Message Hermes", { exact: true })
        .fill("A draft saved after reclaiming cache space");
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const request = indexedDB.open("arura");
            const db = await new Promise<IDBDatabase>((resolve) => {
              request.onsuccess = () => resolve(request.result);
            });
            const get = (store: string, key: string) =>
              new Promise((resolve) => {
                const request = db
                  .transaction(store)
                  .objectStore(store)
                  .get(key);
                request.onsuccess = () => resolve(request.result);
              });
            const values = await Promise.all([
              get("drafts", localStorage.getItem("arura.view")!),
              get("cache", "chat:old"),
              get("cache", "attachments:protected"),
            ]);
            db.close();
            return values;
          }),
        )
        .toEqual([
          "A draft saved after reclaiming cache space",
          undefined,
          [{ path: "/fixture/draft.txt" }],
        ]);
    } finally {
      await browser.close();
    }
  },
});
