import { strict as assert } from "node:assert";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";
import { identity } from "../server/identity.ts";

async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error("Subscription did not update within ten seconds");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

Deno.test({
  name:
    "self-hosted Convex: two-device sync, command claims, invite reuse, and live revocation",
  ignore: !Deno.env.get("CONVEX_SELF_HOSTED_URL"),
  async fn() {
    const url = Deno.env.get("CONVEX_SELF_HOSTED_URL")!;
    const signer = await identity();
    const adapter = new ConvexHttpClient(url);
    adapter.setAuth(await signer.sign("arura:adapter"));
    const aId = crypto.randomUUID(),
      bId = crypto.randomUUID();
    const a = new ConvexHttpClient(url);
    a.setAuth(await signer.sign(aId));
    const b = new ConvexHttpClient(url);
    b.setAuth(await signer.sign(bId));
    const create = (id: string, bootstrap: boolean, inviteHash?: string) =>
      adapter.mutation(api.devices.authorize, {
        id,
        secretHash: crypto.randomUUID(),
        name: id,
        bootstrap,
        ...(inviteHash ? { inviteHash } : {}),
      });
    await create(aId, true);
    const inviteHash = crypto.randomUUID();
    await a.mutation(api.devices.issueInvite, { hash: inviteHash });
    await create(bId, false, inviteHash);
    await assert.rejects(
      () => create(crypto.randomUUID(), false, inviteHash),
      /expired or invalid/,
    );
    const live = new ConvexClient(url);
    live.setAuth(() => signer.sign(bId));
    let snapshot: any,
      revoked = false;
    const stop = live.onUpdate(
      api.workspace.overview,
      {},
      (value) => {
        snapshot = value;
      },
      (error) => {
        revoked = /revoked|uthoriz/i.test(error.message);
      },
    );
    try {
      // This test writes a synthetic read model directly. Pause only the
      // disposable adapter so its correct source reconciliation cannot delete
      // rows that deliberately have no corresponding Hermes fixture session.
      const pid = Number(Deno.env.get("ARURA_TEST_ADAPTER_PID"));
      if (pid) Deno.kill(pid, "SIGSTOP");
      await until(() => Boolean(snapshot));
      const key = JSON.stringify(["test", crypto.randomUUID()]);
      await adapter.mutation(api.workspace.ingest, {
        conversations: [
          {
            key,
            sourceId: key,
            profile: "test",
            title: "Original",
            activityAt: Date.now(),
          },
        ],
      });
      await until(() => snapshot.conversations.some((c: any) => c.key === key));
      const folderName = `Folder ${crypto.randomUUID()}`;
      await a.mutation(api.workspace.folder, { name: folderName });
      await until(() =>
        snapshot.folders.some((f: any) => f.name === folderName)
      );
      const folder = snapshot.folders.find((f: any) => f.name === folderName);
      await a.mutation(api.workspace.move, {
        key,
        section: "pinned",
        folderId: folder._id,
      });
      await until(() =>
        snapshot.conversations.some(
          (c: any) => c.key === key && c.folderId === folder._id,
        )
      );
      await b.mutation(api.workspace.folder, {
        id: folder._id,
        name: `${folderName} renamed`,
      });
      assert.equal(
        (await a.query(api.workspace.overview, {})).folders.find(
          (f: any) => f._id === folder._id,
        ).name,
        `${folderName} renamed`,
      );
      await assert.rejects(
        () =>
          a.mutation(api.workspace.move, {
            key,
            section: "essential",
            folderId: folder._id,
          }),
        /Folders belong in Pinned/,
      );
      await a.mutation(api.workspace.folder, { name: `${folderName} second` });
      const folders = (await b.query(api.workspace.overview, {})).folders;
      const second = folders.find(
        (f: any) => f.name === `${folderName} second`,
      );
      await b.mutation(api.workspace.reorder, {
        kind: "folder",
        id: second._id,
        direction: -1,
      });
      const reordered = (await a.query(api.workspace.overview, {})).folders;
      assert(
        reordered.findIndex((f: any) => f._id === second._id) <
          reordered.findIndex((f: any) => f._id === folder._id),
      );
      await b.mutation(api.workspace.folder, { id: folder._id, remove: true });
      const afterRemoval = await a.query(api.workspace.byKey, { key });
      assert.equal(afterRemoval.section, "pinned");
      assert.equal(afterRemoval.folderId, undefined);
      await a.mutation(api.workspace.folder, { id: second._id, remove: true });
      const page = (
        offset: number,
        revision: string,
        headRevision?: string,
      ) => ({
        conversation: key,
        offset,
        revision,
        ...(headRevision ? { headRevision } : {}),
        messages: [
          { id: `message-${revision}`, role: "assistant", text: revision },
        ],
        hasMore: true,
      });
      await adapter.mutation(api.workspace.ingest, { page: page(0, "first") });
      await adapter.mutation(api.workspace.ingest, {
        page: page(100, "older", "first"),
      });
      assert.equal(
        (
          await a.query(api.workspace.transcript, {
            conversation: key,
            pages: 2,
          })
        ).pages.length,
        2,
      );
      await adapter.mutation(api.workspace.ingest, {
        page: page(0, "new-message"),
      });
      assert.equal(
        (
          await a.query(api.workspace.transcript, {
            conversation: key,
            pages: 2,
          })
        ).pages.length,
        1,
      );
      await adapter.mutation(api.workspace.ingest, {
        page: page(100, "stale-response", "first"),
      });
      assert.equal(
        (
          await a.query(api.workspace.transcript, {
            conversation: key,
            pages: 2,
          })
        ).pages.length,
        1,
      );
      await adapter.mutation(api.workspace.ingest, {
        page: page(100, "fresh-older", "new-message"),
      });
      assert.equal(
        (
          await a.query(api.workspace.transcript, {
            conversation: key,
            pages: 2,
          })
        ).pages.length,
        2,
      );
      await a.mutation(api.workspace.move, { key, section: "essential" });
      await until(() =>
        snapshot.conversations.some(
          (c: any) => c.key === key && c.section === "essential",
        )
      );
      await a.mutation(api.workspace.move, { key, section: "archived" });
      assert(
        (await b.query(api.workspace.archived, { cursor: null })).page.some(
          (c: any) => c.key === key,
        ),
      );
      await b.mutation(api.workspace.move, { key, section: "recent" });
      await until(() =>
        snapshot.conversations.some(
          (c: any) => c.key === key && c.unarchivedAt,
        )
      );
      const archiveKeys = Array.from(
        { length: 13 },
        () => JSON.stringify(["test", crypto.randomUUID()]),
      );
      await adapter.mutation(api.workspace.ingest, {
        conversations: archiveKeys.map((key) => ({
          key,
          sourceId: key,
          profile: "test",
          title: "Archive page test",
          activityAt: Date.now(),
        })),
      });
      for (const key of archiveKeys) {
        await a.mutation(api.workspace.move, { key, section: "archived" });
      }
      const firstArchive = await b.query(api.workspace.archived, {
        cursor: null,
      });
      assert.equal(firstArchive.page.length, 10);
      assert.equal(firstArchive.isDone, false);
      const nextArchive = await b.query(api.workspace.archived, {
        cursor: firstArchive.continueCursor,
      });
      const loadedKeys = new Set(
        [...firstArchive.page, ...nextArchive.page].map((row: any) => row.key),
      );
      assert(archiveKeys.every((key) => loadedKeys.has(key)));
      const admin = new ConvexHttpClient(url);
      // This key exists only in the isolated test stack; ordinary devices cannot run internal sweeps.
      (admin as unknown as { setAdminAuth(key: string): void }).setAdminAuth(
        Deno.env.get("CONVEX_SELF_HOSTED_ADMIN_KEY")!,
      );
      const prefix = crypto.randomUUID();
      const archiveCases = Array.from({ length: 1005 }, (_, i) => ({
        key: JSON.stringify([prefix, String(i)]),
        sourceId: String(i),
        profile: prefix,
        title: "Archive sweep boundary",
        activityAt: i < 1000 ? Date.now() : 0,
      }));
      for (let i = 0; i < archiveCases.length; i += 200) {
        await adapter.mutation(api.workspace.ingest, {
          conversations: archiveCases.slice(i, i + 200),
        });
      }
      const overdue = archiveCases[1004].key;
      const overview = await a.query(api.workspace.overview, {});
      const navigation = new Set(
        overview.conversations.map((row: any) => row.key),
      );
      let cursor = overview.recentCursor,
        more = overview.recentHasMore;
      while (more) {
        const result = await a.query(api.workspace.recent, { cursor });
        for (const row of result.page) navigation.add(row.key);
        cursor = result.continueCursor;
        more = !result.isDone;
      }
      assert(
        archiveCases.every((row) => navigation.has(row.key)),
        "Recent navigation reaches conversations beyond the first 1,000 entries",
      );
      await a.mutation(api.workspace.move, {
        key: overdue,
        section: "recent",
        rank: Number.MAX_SAFE_INTEGER,
      });
      await admin.mutation(api.workspace.sweep, {});
      await expectArchived(overdue);
      await a.mutation(api.workspace.move, { key: overdue, section: "recent" });
      await admin.mutation(api.workspace.sweep, {});
      assert.equal(
        (await a.query(api.workspace.byKey, { key: overdue })).section,
        "recent",
      );
      // Remove synthetic scale data so it cannot crowd subsequent browser test navigation.
      for (let i = 0; i < archiveCases.length; i += 200) {
        await adapter.mutation(api.workspace.ingest, {
          deletedKeys: archiveCases.slice(i, i + 200).map((row) => row.key),
        });
      }
      async function expectArchived(key: string) {
        const deadline = Date.now() + 10000;
        while (
          (await a.query(api.workspace.byKey, { key })).section !== "archived"
        ) {
          if (Date.now() > deadline) {
            throw new Error("Archive sweep did not reach later pages");
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const command = {
        id: crypto.randomUUID(),
        conversation: key,
        kind: "send",
        payload: { text: "One request" },
      };
      const ids = await Promise.all([
        a.mutation(api.commands.enqueue, command),
        a.mutation(api.commands.enqueue, command),
      ]);
      assert.equal(ids[0], ids[1]);
      const claims = await Promise.all(
        ids.map((id) => adapter.mutation(api.commands.claim, { id })),
      );
      assert.equal(claims.filter(Boolean).length, 1);
      await assert.rejects(
        () => b.mutation(api.commands.enqueue, command),
        /another device/,
      );
      await assert.rejects(
        () =>
          a.mutation(api.commands.enqueue, {
            ...command,
            id: crypto.randomUUID(),
            kind: "rpc",
            payload: { method: "secret.respond", value: "must-not-persist" },
          }),
        /Sensitive input/,
      );
      const blockedId = await b.mutation(api.commands.enqueue, {
        ...command,
        id: crypto.randomUUID(),
      });
      await a.mutation(api.devices.revoke, { id: bId });
      await until(() => revoked);
      await assert.rejects(
        () => b.query(api.workspace.overview, {}),
        /revoked|uthoriz/,
      );
      assert.equal(
        await adapter.mutation(api.commands.claim, { id: blockedId }),
        null,
      );
      assert(
        (await a.query(api.devices.list, {})).every(
          (d: any) => !("secretHash" in d),
        ),
      );
    } finally {
      const pid = Number(Deno.env.get("ARURA_TEST_ADAPTER_PID"));
      if (pid) Deno.kill(pid, "SIGCONT");
      stop();
      await live.close();
      await a.mutation(api.devices.revoke, { id: aId });
    }
  },
});
