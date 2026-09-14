---
name: encode-intent
description: Save lasting decisions and constraints from a session when asked to encode intent or record what was decided. Not for routine task completion.
---

# Encode intent

Save what a future reader needs to avoid repeating costly discovery or undoing a deliberate choice. Save the useful parts, not the session.

## Pick what matters

Use the conversation and relevant changes. Keep only:
- Decisions whose reasons are not obvious from the code, including meaningful rejected alternatives.
- Surprising facts that were costly to learn, with evidence and any limits on when they apply.
- Rules that must hold, external contracts, and words with a special meaning here.

Ask: **Without this, would someone redo work or undo work?** If neither, skip it. Do not invent reasons or present guesses as facts. If nothing qualifies, say so and stop.

## Put it where it belongs

Inspect existing guidance and docs for the affected area only. Follow the repo's conventions; edit an existing home before adding one.

| What | Home |
|---|---|
| Rule a machine can check | Existing test, type, schema, or check; add enforcement if within scope |
| Non-obvious reason for nearby code | Short comment beside that code |
| Significant decision and tradeoffs | Decision record, if the repo uses them |
| Current contract, costly fact, or local term | The affected area's living doc |
| Remaining work or blockers | Existing tracker, within the user's authorization |
| Change-specific explanation | Commit or PR body, if already being prepared |

Keep one source for each fact; link instead of copying. A check can enforce a rule while a short note explains why. Do not claim enforcement that was not verified or assume passing tests capture every constraint.

## Keep future reading small

- Give each new note a clear read condition: “Read when changing X.” Link it from the nearest relevant guide or scoped `AGENTS.md`, with that condition.
- Keep always-loaded guidance short. Put detailed reasons beside the affected code or in the area's doc.
- Update current docs in place; follow existing conventions for superseding old decisions.
- Do not scan all historical plans, create a doc tree, or add an invariant catalog just for this task. With no suitable home, propose the smallest one.
- Do not create session logs or plan files. Do not delete existing notes without checking their ownership and remaining value.
- If tracker access or another needed action is unavailable, report what remains unsaved. Do not quietly lose it or create a substitute backlog.

Finish with a short list of what was saved and where, what was skipped and why, and anything still unsaved. No repeated session narrative.
