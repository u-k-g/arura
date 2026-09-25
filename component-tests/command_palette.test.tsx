import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type JSX, Show } from "solid-js";
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
          items={query().match(/^[1-9]$/)
            ? choices.filter((item) => item.slot === Number(query()))
            : choices.filter((item) =>
              item.label.toLowerCase().includes(query().toLowerCase())
            )}
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

test("arrow keys, Home, and End select the visible action", () => {
  const run = renderPalette([
    { id: "first", label: "First", group: "Commands", run() {} },
    { id: "second", label: "Second", group: "Commands", run() {} },
    { id: "third", label: "Third", group: "Commands", run() {} },
  ]);
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(
    screen.getByRole("option", { name: "Third" }).getAttribute(
      "aria-selected",
    ),
  ).toBe("true");
  fireEvent.keyDown(input, { key: "Home" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(run).toHaveBeenCalledExactlyOnceWith("second");
});

test("clear search restores results and keeps focus in the input", () => {
  const run = renderPalette([
    { id: "first", label: "First", group: "Commands", run() {} },
  ]);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  input.focus();
  fireEvent.input(input, { target: { value: "missing" } });
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(input.value).toBe("");
  expect(screen.getByRole("option", { name: "First" })).toBeTruthy();
  expect(document.activeElement).toBe(input);
  expect(run).not.toHaveBeenCalled();
});

test("a late result does not change the selected action", () => {
  const run = vi.fn();
  const first = { id: "first", label: "First", group: "Chats", run };
  const second = { id: "second", label: "Second", group: "Chats", run };
  const [items, setItems] = createSignal([first, second]);
  render(() => (
    <CommandPalette
      query=""
      search={() => {}}
      items={items()}
      searching={false}
      error=""
      close={() => {}}
    />
  ));
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  setItems([{ id: "late", label: "Late", group: "Chats", run }, first, second]);
  expect(
    screen.getByRole("option", { name: "Second" }).getAttribute(
      "aria-selected",
    ),
  ).toBe("true");
  fireEvent.keyDown(input, { key: "Enter" });
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
  expect(screen.queryByText("No matches. Try a different name or phrase."))
    .toBeNull();
});
