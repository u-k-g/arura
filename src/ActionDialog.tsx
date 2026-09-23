import { createSignal, Show } from "solid-js";
import { Dialog, Field } from "./ui.tsx";
type Question = {
  title: string;
  value?: string;
  multiline?: boolean;
  message?: string;
  confirmLabel?: string;
  resolve: (answer: string | null) => void;
};
const [question, setQuestion] = createSignal<Question>();
const pending: Question[] = [];
function next() {
  setQuestion(pending.shift());
}
export function ask(
  title: string,
  value = "",
  multiline = false,
): Promise<string | null> {
  return new Promise((resolve) => {
    pending.push({ title, value, multiline, resolve });
    if (!question()) next();
  });
}
export async function confirmAction(
  title: string,
  options?: { message?: string; confirmLabel?: string },
): Promise<boolean> {
  return (
    (await new Promise<string | null>((resolve) => {
      pending.push({ title, ...options, resolve });
      if (!question()) next();
    })) !== null
  );
}
export async function rejectAction(title: string) {
  return !(await confirmAction(title));
}
export default function ActionDialog() {
  const [value, setValue] = createSignal("");
  function finish(answer: string | null) {
    question()?.resolve(answer);
    next();
  }
  return (
    <Show when={question()} keyed>
      {(item) => {
        setValue(item.value ?? "");
        return (
          <Dialog
            class="action-dialog"
            title={item.title}
            close={() => finish(null)}
          >
            <Show when={item.message}>
              <p class="action-dialog-message">{item.message}</p>
            </Show>
            <Show when={item.value !== undefined}>
              <Field label="Value">
                <Show
                  when={item.multiline}
                  fallback={
                    <input
                      aria-label={item.title}
                      value={value()}
                      onInput={(event) => setValue(event.currentTarget.value)}
                      autofocus
                    />
                  }
                >
                  <textarea
                    aria-label={item.title}
                    value={value()}
                    onInput={(event) => setValue(event.currentTarget.value)}
                    autofocus
                    rows={5}
                  />
                </Show>
              </Field>
            </Show>
            <div class="row">
              <button type="button" onClick={() => finish(null)}>
                Cancel
              </button>
              <button
                type="button"
                class="primary"
                onClick={() => finish(value())}
              >
                {item.confirmLabel ??
                  (item.value === undefined ? "Confirm" : "Save")}
              </button>
            </div>
          </Dialog>
        );
      }}
    </Show>
  );
}
