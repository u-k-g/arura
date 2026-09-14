import { strict as assert } from "node:assert";
import { incomingOrganization } from "../shared/organization.ts";

Deno.test("Hermes organization imports existing pins/archives and preserves web-only placement", () => {
  assert.equal(
    incomingOrganization(null, { pinned: true, archived: false }, 10).section,
    "pinned",
  );
  assert.equal(
    incomingOrganization(null, { pinned: true, archived: true }, 10).section,
    "archived",
  );
  const essential = {
    section: "essential" as const,
    sourcePinned: true,
    sourceArchived: false,
  };
  assert.equal(
    incomingOrganization(essential, { pinned: true, archived: false }, 20)
      .section,
    undefined,
  );
  assert.equal(
    incomingOrganization(essential, { pinned: false, archived: false }, 20)
      .section,
    "recent",
  );
  const folder = {
    section: "pinned" as const,
    folderId: "folder",
    sourcePinned: true,
    sourceArchived: false,
  };
  assert.equal(
    incomingOrganization(folder, { pinned: true, archived: false }, 20).section,
    undefined,
  );
  const archived = incomingOrganization(
    folder,
    { pinned: false, archived: true },
    20,
  );
  assert.equal(archived.section, "archived");
  assert.equal(archived.folderId, undefined);
  assert.equal(archived.archivedAt, 20);
  assert.equal(
    incomingOrganization(
      { section: "archived", sourceArchived: true, sourcePinned: false },
      { archived: false, pinned: false },
      30,
    ).unarchivedAt,
    30,
  );
});

Deno.test("Pending Arura writes and missing upstream fields cannot be overwritten by snapshots", () => {
  assert.deepEqual(
    incomingOrganization(
      { section: "pinned", organizationPending: true },
      { pinned: false, archived: false },
      10,
    ),
    {},
  );
  assert.deepEqual(incomingOrganization({ section: "archived" }, {}, 10), {});
  assert.equal(
    incomingOrganization(
      { section: "archived", sourceArchived: true, sourcePinned: false },
      { pinned: true },
      10,
    ).section,
    "archived",
  );
});
