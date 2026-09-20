import { createEffect, createSignal, For, Show } from "solid-js";
import type { ClarificationQuestion, Interaction } from "../shared/model.ts";
import { Field, run } from "./ui.tsx";

function Question(props: {
  question: ClarificationQuestion;
  submit: (answer: string) => Promise<unknown>;
  batch: boolean;
}) {
  const [text, setText] = createSignal("");
  const [selected, setSelected] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  let restored: string | undefined;
  createEffect(() => {
    const answer = props.question.answer;
    if (answer === undefined || answer === restored) return;
    restored = answer;
    if (props.question.multiple) {
      try {
        const values = JSON.parse(answer);
        if (Array.isArray(values)) {
          setSelected(
            values.filter((value) => props.question.options.includes(value)),
          );
          setText(
            values
              .filter((value) => !props.question.options.includes(value))
              .join(", "),
          );
          return;
        }
      } catch {
        /* Older free-text answers remain editable. */
      }
    }
    setText(answer);
  });
  async function submit(skip = false) {
    setBusy(true);
    try {
      const answer = skip
        ? ""
        : props.question.multiple
          ? JSON.stringify([
              ...selected(),
              ...(text().trim() ? [text().trim()] : []),
            ])
          : text().trim();
      await props.submit(answer);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => submit());
      }}
    >
      <fieldset disabled={busy()}>
        <legend>{props.question.text}</legend>
        <Show when={props.question.answer !== undefined}>
          <p role="status">
            Answer saved. You can change it while other questions are pending.
          </p>
        </Show>
        <Show
          when={props.question.multiple}
          fallback={
            <Field label="Your answer">
              <input
                value={text()}
                required
                list={`clarify-${props.question.id}`}
                onInput={(event) => setText(event.currentTarget.value)}
              />
              <datalist id={`clarify-${props.question.id}`}>
                <For each={props.question.options}>
                  {(option) => <option value={option} />}
                </For>
              </datalist>
            </Field>
          }
        >
          <For each={props.question.options}>
            {(option) => (
              <Field label={option}>
                <input
                  type="checkbox"
                  checked={selected().includes(option)}
                  onChange={(event) =>
                    setSelected((values) =>
                      event.currentTarget.checked
                        ? [...values, option]
                        : values.filter((value) => value !== option),
                    )
                  }
                />
              </Field>
            )}
          </For>
          <Field label="Other answer">
            <input
              value={text()}
              onInput={(event) => setText(event.currentTarget.value)}
            />
          </Field>
        </Show>
        <div class="resource-actions">
          <button
            type="submit"
            class="primary"
            disabled={!text().trim() && !selected().length}
          >
            {props.batch ? "Confirm answer" : "Answer"}
          </button>
          <button type="button" onClick={() => void run(() => submit(true))}>
            Skip question
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export default function Clarification(props: {
  interaction: Interaction;
  respond: (params: Record<string, unknown>) => Promise<unknown>;
}) {
  return (
    <Show
      when={props.interaction.questions?.length}
      fallback={
        <Question
          batch={false}
          question={{
            id: props.interaction.id,
            text: props.interaction.text,
            options: props.interaction.options ?? [],
            multiple: props.interaction.multiple ?? false,
          }}
          submit={(answer) =>
            props.respond({ request_id: props.interaction.id, answer })
          }
        />
      }
    >
      <For each={props.interaction.questions?.map((question) => question.id)}>
        {(id) => (
          <Show
            when={props.interaction.questions?.find(
              (question) => question.id === id,
            )}
          >
            {(question) => (
              <Question
                batch
                question={question()}
                submit={(answer) =>
                  props.respond({
                    request_id: props.interaction.id,
                    question_id: id,
                    answer,
                  })
                }
              />
            )}
          </Show>
        )}
      </For>
    </Show>
  );
}
