import { fireEvent, render, screen } from "@solidjs/testing-library";
import { expect, test } from "vitest";
import { AnswerMarkdown, splitSourcesSection } from "../src/Markdown.tsx";

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
