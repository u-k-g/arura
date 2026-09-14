import { openDB } from "idb";
import { createSignal } from "solid-js";
export const [cacheIssue, setCacheIssue] = createSignal("");
const volatilePreferences = new Map<string, string>();
export const preferences = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key) ?? volatilePreferences.get(key) ?? null;
    } catch {
      return volatilePreferences.get(key) ?? null;
    }
  },
  setItem(key: string, value: string) {
    volatilePreferences.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Keep preferences for this open browser. */
    }
  },
};
function unavailable(error: unknown) {
  setCacheIssue(
    error instanceof DOMException && error.name === "QuotaExceededError"
      ? "Device storage is full. New data is available online but cannot be saved locally."
      : "This browser cannot save local data. Conversations remain available while connected.",
  );
}
const db = Promise.resolve()
  .then(() =>
    openDB("arura", 2, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          db.createObjectStore("cache");
          db.createObjectStore("drafts");
        }
        const metadata = db.createObjectStore("cacheMetadata");
        if (oldVersion === 1) {
          void transaction
            .objectStore("cache")
            .getAllKeys()
            .then((keys) => {
              for (const key of keys) void metadata.put({ touchedAt: 0 }, key);
            });
        }
      },
      blocking(_currentVersion, _blockedVersion, event) {
        (event.target as IDBDatabase).close();
      },
    })
  )
  .catch((error) => {
    unavailable(error);
    return undefined;
  });
export type DraftAttachment = { path: string; name: string; image: boolean };
const attachmentDrafts = new Map<string, DraftAttachment[]>();
export async function draftAttachments(
  key: string,
  attachments?: DraftAttachment[],
) {
  if (attachments !== undefined) {
    attachmentDrafts.set(key, attachments);
    await saveCache("attachments:" + key, attachments);
    return attachments;
  }
  return (
    attachmentDrafts.get(key) ??
      (await loadCache<DraftAttachment[]>("attachments:" + key)) ??
      []
  );
}
let generation = 0;
const drafts = new Map<string, string>();
export const caching = () => preferences.getItem("arura.keepData") !== "false";
export async function loadCache<T>(key: string): Promise<T | undefined> {
  if (!caching()) return;
  const current = generation;
  try {
    const value = await (await db)?.get("cache", key);
    return current === generation && caching() ? value : undefined;
  } catch (error) {
    unavailable(error);
  }
}
async function evictCachedContent(protectedKey: string, current: number) {
  const d = await db;
  if (!d || current !== generation || !caching()) return;
  const tx = d.transaction(["cache", "cacheMetadata"], "readwrite");
  const metadata = tx.objectStore("cacheMetadata");
  const keys = await metadata.getAllKeys();
  const rows = await metadata.getAll();
  const eligible = keys
    .map((key, index) => ({ key, touchedAt: rows[index].touchedAt }))
    .filter(
      ({ key }) =>
        key !== protectedKey &&
        key !== "workspace" &&
        !String(key).startsWith("attachments:"),
    )
    .sort((a, b) => a.touchedAt - b.touchedAt);
  for (
    const { key } of eligible.slice(
      0,
      Math.max(1, Math.ceil(eligible.length / 4)),
    )
  ) {
    await tx.objectStore("cache").delete(key);
    await metadata.delete(key);
  }
  await tx.done;
}
async function persist(
  store: "cache" | "drafts",
  key: string,
  value: unknown,
  current: number,
) {
  const d = await db;
  if (!d || !caching() || current !== generation) return;
  const write = async () => {
    if (!caching() || current !== generation) return;
    const tx = d.transaction(
      store === "cache" ? [store, "cacheMetadata"] : [store],
      "readwrite",
    );
    // Observe transaction rejection as well as request rejection on quota failure.
    const done = tx.done;
    void done.catch(() => {});
    await tx.objectStore(store).put(value, key);
    if (store === "cache") {
      await tx.objectStore("cacheMetadata").put({ touchedAt: Date.now() }, key);
    }
    await done;
  };
  try {
    await write();
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      error.name !== "QuotaExceededError"
    ) {
      throw error;
    }
    await evictCachedContent(key, current);
    await write();
  }
}
export async function saveCache(key: string, value: unknown) {
  try {
    await persist("cache", key, value, generation);
  } catch (error) {
    unavailable(error);
  }
}
export async function clearCache() {
  generation++;
  drafts.clear();
  attachmentDrafts.clear();
  const d = await db;
  try {
    await Promise.all([
      d?.clear("cache"),
      d?.clear("cacheMetadata"),
      d?.clear("drafts"),
    ]);
  } catch (error) {
    unavailable(error);
  }
}
export async function draft(key: string, text?: string) {
  if (text !== undefined) drafts.set(key, text);
  else if (drafts.has(key)) return drafts.get(key);
  const current = generation;
  const d = await db;
  if (!caching() || current !== generation) return;
  try {
    if (text === undefined) {
      const value = await d?.get("drafts", key);
      return current === generation ? (value as string | undefined) : undefined;
    }
    await persist("drafts", key, text, current);
  } catch (error) {
    unavailable(error);
  }
}
export async function storageInfo() {
  return (await navigator.storage?.estimate()) ?? {};
}
