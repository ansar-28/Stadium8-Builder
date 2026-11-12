# PLAN Phase Context (post-compaction)

This file is injected by `inject-phase-context.js` when the orchestrator session is resumed after auto-compaction. Its job is to restore enough context for `/continue` to pick up cleanly — not to re-document the flow.

**Canonical sources:**
- Phase orchestration → [`commands/continue.md`](../../commands/continue.md) § Phase: PLAN
- Single-mode contract → [`agents/feature-planner.md`](../../agents/feature-planner.md)
- Approval pattern → [`shared/approval-pattern.md`](../../shared/approval-pattern.md)

## Key file paths

- Project facts: `generated-docs/project.md` (on main, inherited)
- Epic brief: `generated-docs/epics/<slug>/brief.md` (on this branch — feature requirements for this epic only)
- State: `generated-docs/epics/<slug>/state.json`
- Story files (after stories approved): `generated-docs/epics/<slug>/stories/story-<N>-<slug>.md`

## Determining current stage after compaction

| `stories[*]` in state.json? | Story files written? | Current stage |
|---|---|---|
| Empty `{}` | No | Pre-stories — re-invoke `feature-planner` |
| Populated | Yes | PLAN complete — take the PLAN exit (see below) |
| Populated | No | Mid-write of story files — surface to user; re-invoke `feature-planner` if uncertain |

**This snippet describes the epic on *this window's branch*.** `inject-phase-context.js` fires only on an `epic/<slug>` branch that already has a `state.json`, so the phase, the paths and the stage table above are all that epic's — a missing state file is never the injected case.

- **`/continue` or `/start`** (the ordinary case — you're building this epic through) — commit the stories, transition `state.json.phase` to `BUILD`, and proceed into the BUILD loop. See [`commands/continue.md`](../../commands/continue.md) § Phase: PLAN ("On approval") for the commit, then § Phase: BUILD.
- **Mid-`/plan`? Then this snippet is not about the epic you're planning.** `/plan` deliberately leaves this window's branch alone ([`plan.md` Step 0](../../commands/plan.md#step-0-check-the-workspace-is-safe)), so a window that happened to be sitting on `epic/<slug>` still gets this injected — describing the *other* epic. **Don't take the BUILD exit above**; it would build a different epic than the one you were planning. Your epic's `brief.md`, `state.json` and story files live under the throwaway worktree, not the paths listed above, and its stage isn't in that table at all — `state.json` doesn't exist until [`plan.md` Step 3c](../../commands/plan.md#step-3c-lay-down-the-plan-skeleton), so Steps 3a and 3b are invisible to it. Pick the run back up from [`plan.md` Step 3](../../commands/plan.md#step-3-open-the-background-worktree): only a populated `stories` is resumable, and it resumes at [Step 5](../../commands/plan.md#step-5-park-it-on-main--the-plan-exit). **Stop; do not build.**

The orchestrator updates `state.json` via Edit; the PLAN "On approval" step persists the story files.
