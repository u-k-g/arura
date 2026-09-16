import { equal } from "node:assert/strict";
import { toolPresentation } from "../shared/tool-presentation.ts";
Deno.test("tool summaries use relevant arguments and omit URL credentials", () => {
  equal(
    toolPresentation("read_file", '{"path":"report.md"}').label,
    "Read report.md",
  );
  equal(
    toolPresentation("web_search", { query: "weather tomorrow" }).label,
    "Searched for weather tomorrow",
  );
  equal(
    toolPresentation("web_extract", {
      url: "https://user:secret@example.com/docs?token=hidden",
    }).label,
    "Read example.com/docs",
  );
  equal(
    toolPresentation("skill_view", { name: "gardening" }).label,
    "Read skill: gardening",
  );
  equal(toolPresentation("read_file", "invalid").label, "Read a file");
});
