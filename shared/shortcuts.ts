export const shortcuts = [
  { id: "palette", label: "Find conversations and actions", default: "Mod+k" },
  { id: "newChat", label: "New conversation", default: "Mod+Shift+o" },
] as const;

export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): string | undefined {
  if (event.key.length !== 1 || !(event.ctrlKey || event.metaKey)) return;
  return [
    "Mod",
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    event.key.toLowerCase(),
  ].join("+");
}
