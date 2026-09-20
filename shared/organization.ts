type Section = "recent" | "pinned" | "essential" | "archived";
type Organization = {
  section: Section;
  folderId?: string;
  sourcePinned?: boolean;
  sourceArchived?: boolean;
  organizationPending?: boolean;
};

/** Only observed upstream changes replace Arura-only Essentials/folder placement. */
export function incomingOrganization(
  old: Organization | null,
  incoming: { pinned?: boolean; archived?: boolean },
  now: number,
): Partial<
  Pick<Organization, "section" | "sourcePinned" | "sourceArchived">
> & { folderId?: undefined; archivedAt?: number; unarchivedAt?: number } {
  if (old?.organizationPending) return {};
  if (incoming.pinned === undefined && incoming.archived === undefined) {
    return {};
  }
  const pinned = incoming.pinned ?? old?.sourcePinned;
  const archived = incoming.archived ?? old?.sourceArchived;
  const observed = {
    ...(pinned !== undefined ? { sourcePinned: pinned } : {}),
    ...(archived !== undefined ? { sourceArchived: archived } : {}),
  };
  if (old && old.sourcePinned === pinned && old.sourceArchived === archived) {
    return observed;
  }
  const section: Section =
    archived === true
      ? "archived"
      : pinned === true
        ? old?.section === "essential"
          ? "essential"
          : "pinned"
        : pinned === false || archived === false
          ? "recent"
          : (old?.section ?? "recent");
  return {
    ...observed,
    section,
    ...(section !== "pinned" && section !== "essential"
      ? { folderId: undefined }
      : {}),
    archivedAt: section === "archived" ? now : undefined,
    ...(old?.section === "archived" && section !== "archived"
      ? { unarchivedAt: now }
      : {}),
  };
}
