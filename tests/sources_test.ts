import { deepStrictEqual, equal } from "node:assert/strict";
import { sourceLinks, splitSourcesSection } from "../src/sources.ts";

Deno.test("collapses a citation paragraph followed by a sources note", () => {
  const text =
    "Answer with citations.[4]\n\nSources:\n" +
    "[4] https://example.com/four — fourth source\n" +
    "[5] https://example.com/five — fifth source\n\n" +
    "Sources [1]–[3] from the previous message also apply.";
  const section = splitSourcesSection(text);
  equal(section?.answer, "Answer with citations.[4]");
  equal(
    section?.sources,
    "[4] https://example.com/four — fourth source\n" +
      "[5] https://example.com/five — fifth source\n\n" +
      "Sources [1]–[3] from the previous message also apply.",
  );
});

Deno.test("keeps one-line and bulleted sources collapsible", () => {
  deepStrictEqual(
    splitSourcesSection("Answer.\n\nSources: [109] https://example.com"),
    { answer: "Answer.", sources: "[109] https://example.com" },
  );
  deepStrictEqual(
    splitSourcesSection(
      "Answer.\n\nSources:\n- https://one.example\n- https://two.example",
    ),
    {
      answer: "Answer.",
      sources: "- https://one.example\n- https://two.example",
    },
  );
});

Deno.test("collapses a sources list before a closing answer note", () => {
  deepStrictEqual(
    splitSourcesSection(
      "Answer.\n\nSources:\n" +
        "- https://islamqa.info/en/answers/83154 (first source)\n" +
        "- https://islamqa.org/shafii/qibla-shafii/33507 (second source)\n\n" +
        "This is a relay of positions, not my own ruling.",
    ),
    {
      answer: "Answer.",
      sources:
        "- https://islamqa.info/en/answers/83154 (first source)\n" +
        "- https://islamqa.org/shafii/qibla-shafii/33507 (second source)",
      after: "This is a relay of positions, not my own ruling.",
    },
  );
});

Deno.test("collapses a sources heading of numbered web links", () => {
  const text =
    "The line is a bond fault.[16]\n\n## Sources\n\n" +
    "[2] https://example.com/two — second source\n" +
    "[16] https://example.com/sixteen — sixteenth source\n\n" +
    "Sources [3] from the previous reply also apply.";
  deepStrictEqual(splitSourcesSection(text), {
    answer: "The line is a bond fault.[16]",
    sources:
      "[2] https://example.com/two — second source\n" +
      "[16] https://example.com/sixteen — sixteenth source\n\n" +
      "Sources [3] from the previous reply also apply.",
  });
});

Deno.test("does not mistake a sources note for a source block", () => {
  equal(
    splitSourcesSection("Answer.\n\nSources [1]–[3] from earlier also apply."),
    undefined,
  );
});

Deno.test("maps only numbered source entries to web links", () => {
  deepStrictEqual(
    [
      ...sourceLinks(
        "[1] https://example.com/one — first\n" +
          "- [5] [Fifth](https://example.com/five)\n" +
          "Sources [2]–[4] from an earlier reply also apply.",
      ),
    ],
    [
      ["1", "https://example.com/one"],
      ["5", "https://example.com/five"],
    ],
  );
});
