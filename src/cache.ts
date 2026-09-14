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
    openDB("arura", 1, {
      upgrade(db) {
        db.createObjectStore("cache");
        db.createObjectStore("drafts");
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
export async function saveCache(key: string, value: unknown) {
  const current = generation;
  const d = await db;
  try {
    if (caching() && current === generation) await d?.put("cache", value, key);
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
    await Promise.all([d?.clear("cache"), d?.clear("drafts")]);
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
    await d?.put("drafts", text, key);
  } catch (error) {
    unavailable(error);
  }
}
export async function storageInfo() {
  return navigator.storage?.estimate() ?? {};
}
