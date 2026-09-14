import { strict as assert } from "node:assert";
import { ConvexHttpClient, ConvexClient } from "convex/browser";
import { anyApi as api } from "convex/server";
import { identity } from "../server/identity.ts";

async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end)
      throw new Error("Subscription did not update within ten seconds");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

Deno.test({
  name: "self-hosted Convex: two-device sync, command claims, invite reuse, and live revocation",
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
        ),
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
        ),
      );
      const archiveKeys = Array.from({ length: 13 }, () =>
        JSON.stringify(["test", crypto.randomUUID()]),
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
      for (const key of archiveKeys)
        await a.mutation(api.workspace.move, { key, section: "archived" });
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
      stop();
      await live.close();
      await a.mutation(api.devices.revoke, { id: aId });
    }
  },
});
