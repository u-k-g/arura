import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { loadCache, saveCache } from "./cache.ts";
import { connected, resource, setScheduleDraft } from "./client.ts";

export default function ContextSuggestions(props: {
  text: string;
  profile: string;
  error?: string;
  useSkill: (name: string) => void;
  navigate: (view: string) => void;
}) {
  const [skills, setSkills] = createSignal<
    { name: string; description?: string }[]
  >([]);
  const [loaded, setLoaded] = createSignal("");
  createEffect(() => {
    const profile = props.profile;
    if (props.text.trim().length < 10 || loaded() === profile) return;
    const online = connected();
    let cancelled = false;
    const timer = setTimeout(async () => {
      const key = `suggested-skills:${profile}`;
      try {
        const cached =
          await loadCache<{ name: string; description?: string }[]>(key);
        if (!cancelled && cached) setSkills(cached);
        if (!online) return;
        const result = await resource("skills", { profile });
        const rows = (Array.isArray(result) ? result : (result.skills ?? []))
          .filter(
            (skill: {
              name: string;
              description?: string;
              enabled?: boolean;
            }) =>
              typeof skill.name === "string" &&
              skill.enabled !== false &&
              !/image[-_ ]?gen|voice|terminal/i.test(skill.name),
          )
          .map(
            (skill: {
              name: string;
              description?: string;
              enabled?: boolean;
            }) => ({
              name: skill.name,
              description:
                typeof skill.description === "string" ? skill.description : "",
            }),
          );
        if (cancelled) return;
        setSkills(rows);
        setLoaded(profile);
        await saveCache(key, rows);
      } catch {
        /* Suggestions must never prevent composing a message. */
      }
    }, 400);
    onCleanup(() => {
      cancelled = true;
      clearTimeout(timer);
    });
  });
  const matching = () => {
    const words = new Set(props.text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    return skills()
      .filter(
        (skill: { name: string; description?: string; enabled?: boolean }) => {
          if (props.text.includes(`/${skill.name}`)) return false;
          const name = skill.name.toLowerCase().split(/[-_ ]/);
          return (
            name.some((word) => words.has(word)) ||
            (skill.description?.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter(
              (word) => words.has(word),
            ).length >= 2
          );
        },
      )
      .slice(0, 2);
  };
  const schedule = () =>
    /\b(remind me|schedule|every (?:day|week|month|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly)\b/i.test(
      props.text,
    );
  const connection = () =>
    /\b(unauthori[sz]ed|authentication|connection expired|reconnect|not connected)\b/i.test(
      props.error ?? "",
    );
  return (
    <Show when={matching().length || schedule() || connection()}>
      <section class="context-suggestions" aria-label="Suggested actions">
        <For each={matching()}>
          {(skill: {
            name: string;
            description?: string;
            enabled?: boolean;
          }) => (
            <button type="button" onClick={() => props.useSkill(skill.name)}>
              Use {skill.name}
            </button>
          )}
        </For>
        <Show when={schedule()}>
          <button
            type="button"
            onClick={() => {
              setScheduleDraft(props.text);
              props.navigate("resources:jobs");
            }}
          >
            Schedule this
          </button>
        </Show>
        <Show when={connection()}>
          <button
            type="button"
            onClick={() => props.navigate("resources:connectors")}
          >
            Review connections
          </button>
        </Show>
      </section>
    </Show>
  );
}
