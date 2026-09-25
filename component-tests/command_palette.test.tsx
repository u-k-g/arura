import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, Show, type JSX } from "solid-js";
import { expect, test, vi } from "vitest";
import CommandPalette, { type PaletteItem } from "../src/CommandPalette.tsx";

vi.mock("../src/ui.tsx", () => ({
  Dialog: (props: { title: string; children: JSX.Element }) => (
    <div role="dialog" aria-label={props.title}>
      {props.children}
    </div>
  ),
  Icon: () => <span aria-hidden="true" />,
}));

function renderPalette(items: PaletteItem[]) {
  const run = vi.fn();
  const choices = items.map((item) => ({
    ...item,
    run: () => run(item.id),
  }));
  const Fixture = () => {
    const [query, setQuery] = createSignal("");
    const [open, setOpen] = createSignal(true);
    return (
      <Show when={open()}>
        <CommandPalette
          query={query()}
          search={setQuery}
          items={
            query().match(/^[1-9]$/)
              ? choices.filter((item) => item.slot === Number(query()))
              : choices
          }
          searching={false}
          error=""
          close={() => setOpen(false)}
        />
      </Show>
    );
  };
  render(() => <Fixture />);
  return run;
}

test("a sidebar digit selects once without Enter", async () => {
  const run = renderPalette([
    { id: "first", label: "First", group: "Chats", slot: 1, run() {} },
    { id: "second", label: "Second", group: "Chats", slot: 2, run() {} },
  ]);
  fireEvent.input(screen.getByRole("combobox"), {
    target: { value: "2" },
  });
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(run).toHaveBeenCalledWith("second");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("an absent slot leaves search available", async () => {
  const run = renderPalette([]);
  fireEvent.input(screen.getByRole("combobox"), {
    target: { value: "9" },
  });
  await Promise.resolve();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(run).not.toHaveBeenCalled();
});

test("rapid repeated selection runs the action once", () => {
  const run = renderPalette([
    { id: "first", label: "First", group: "Chats", run() {} },
  ]);
  const option = screen.getByRole("option");
  fireEvent.click(option);
  fireEvent.click(option);
  expect(run).toHaveBeenCalledTimes(1);
});

test("empty, loading, and error states remain understandable", () => {
  const [searching, setSearching] = createSignal(false);
  const [error, setError] = createSignal("");
  render(() => (
    <CommandPalette
      query="unmatched"
      search={() => {}}
      items={[]}
      searching={searching()}
      error={error()}
      close={() => {}}
    />
  ));
  expect(
    screen.getByText("No matches. Try a different name or phrase."),
  ).toBeTruthy();
  setSearching(true);
  expect(
    screen.queryByText("No matches. Try a different name or phrase."),
  ).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    "Searching message history",
  );
  setSearching(false);
  setError("Search is offline");
  expect(screen.getByRole("alert").textContent).toContain("Search is offline");
});
