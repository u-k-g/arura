export type ReferenceKind = "file" | "folder" | "url" | "image" | "session";
export const referencePattern =
  /@(file|folder|url|image|session):(?:"[^"\n]+"|'[^'\n]+'|`[^`\n]+`|[^\s]+)/g;
export function contextReference(kind: ReferenceKind, value: string) {
  return `@${kind}:${/\s/.test(value) ? JSON.stringify(value) : value}`;
}
export function referenceValue(token: string) {
  return token.slice(token.indexOf(":") + 1).replace(/^["'`]|["'`]$/g, "");
}
export function attachmentHref(value: string) {
  if (
    /^https?:\/\//i.test(value) ||
    /^data:image\/(png|jpeg|webp|gif);/i.test(value)
  ) {
    return value;
  }
  let path = value;
  if (value.startsWith("file://")) {
    try {
      path = decodeURIComponent(new URL(value).pathname);
    } catch {
      return "";
    }
  }
  return `/api/download?path=${encodeURIComponent(path)}`;
}
