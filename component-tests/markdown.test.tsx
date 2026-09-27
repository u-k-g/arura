import { fireEvent, render, screen } from "@solidjs/testing-library";
import { expect, test } from "vitest";
import { AnswerMarkdown } from "../src/Markdown.tsx";
import { splitSourcesSection } from "../src/sources.ts";

test("assistant sources start collapsed and retain their rendered links", () => {
  const answer =
    "The answer stays visible.\n\nSources:\n\n- [Example](https://example.com/source) — context";
  render(() => <AnswerMarkdown text={answer} />);
  expect(screen.getByText("The answer stays visible.")).toBeTruthy();
  const summary = screen.getByText("Sources");
  const details = summary.closest("details");
  expect(details?.open).toBe(false);
  fireEvent.click(summary);
  expect(details?.open).toBe(true);
  expect(
    screen.getByRole("link", { name: "Example" }).getAttribute("href"),
  ).toBe("https://example.com/source");
});

test("numbered sources fold, while ordinary and unfinished text stays visible", () => {
  expect(
    splitSourcesSection("Answer\n\n## Sources\n\n1. [One](https://one.test)"),
  ).toMatchObject({ answer: "Answer" });
  expect(splitSourcesSection("Answer\n\nSources:\n")).toBeUndefined();
  expect(
    splitSourcesSection("Sources: food and water are essential."),
  ).toBeUndefined();
  expect(splitSourcesSection("```\nSources:\n- hidden\n```")).toBeUndefined();
  expect(
    splitSourcesSection("Sources:\n- a\n\nFinal thought."),
  ).toBeUndefined();
});

test("single-line source citations fold without changing the link", () => {
  const answer =
    "A useful answer.\n\nSources: [109] https://www.youtube.com/watch?v=example";
  expect(splitSourcesSection(answer)).toMatchObject({
    answer: "A useful answer.",
    sources: "[109] https://www.youtube.com/watch?v=example",
  });
  render(() => <AnswerMarkdown text={answer} />);
  expect(screen.getByText("Sources").closest("details")?.open).toBe(false);
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "https://www.youtube.com/watch?v=example",
  );
});

test("a source note after numbered citations stays in the disclosure", () => {
  render(() => (
    <AnswerMarkdown
      text={"Answer stays visible.\n\nSources:\n" +
        "[4] https://example.com/four — fourth source\n" +
        "[5] https://example.com/five — fifth source\n\n" +
        "Sources [1]–[3] from the previous answer also apply."}
    />
  ));
  const details = screen.getByText("Sources").closest("details");
  expect(details?.open).toBe(false);
  expect(details?.textContent).toContain("fourth source");
  expect(details?.textContent).toContain("Sources [1]–[3]");
  expect(screen.getByText("Answer stays visible.").closest("details"))
    .toBeNull();
});

test("numbered citations link to current and earlier sources", () => {
  render(() => (
    <AnswerMarkdown
      text={"Current claim.[1][5] Keep `code [1]` unchanged.\n\n" +
        "Sources:\n[1] https://current.example/one — current source"}
      previousReferences={new Map([
        ["1", "https://old.example/one"],
        ["5", "https://earlier.example/five"],
      ])}
    />
  ));
  const current = screen.getByRole("link", { name: "Source 1" });
  const earlier = screen.getByRole("link", { name: "Source 5" });
  expect(current.getAttribute("href")).toBe("https://current.example/one");
  expect(earlier.getAttribute("href")).toBe("https://earlier.example/five");
  expect(current.closest("sup")).toBeTruthy();
  expect(earlier.closest("sup")).toBeTruthy();
  expect(screen.getByText("code [1]").closest("a")).toBeNull();
});
