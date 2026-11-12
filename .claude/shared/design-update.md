# Design-Update Epics (shared)

A **design-update epic** rebuilds screens against design files the user changed in `documentation/`. The user
says so; nothing auto-detects. Its design source and digest ride the epic branch and reach `main` only at merge
([§6.2 carve-out](../policies/epic-branch-concurrency.md#62-shared-evolving-artifacts--pr-time-conflict-resolution)).
These rules are shared by [`/plan`](../commands/plan.md#step-3b-read-the-changed-design-design-update-epic-only),
[`/start`](../commands/start.md#step-b2-cut-the-epic-branch-fresh-from-main) and
[`/continue`](../commands/continue.md#phase-ready-to-build); each command owns its own sequencing.

**The design must be in `documentation/`.** If the user points outside the project, don't read from there. Ask,
then wait: *"Copy those files into `documentation/` and I'll read them from there — that's where your app's
design lives, and it's how the change gets built and saved with the epic."*

## Refresh the digest on the branch

Invoke `design-interpreter` with `timestamp: <ISO 8601 now>`. It reconciles the digest
[in place](../agents/design-interpreter.md#updating-an-existing-digest--reconcile-dont-rewrite) and returns
[four status lines](../agents/design-interpreter.md#return-to-the-orchestrator). `COUNTS: conflicts=<N>` says
how many `CONFLICT:` uncertainties wait in the digest's **Uncertainties** section.

**Before reading the diff**, check whether the digest is brand-new:

```bash
git -C <root> status --porcelain generated-docs/design/digest.md    # `??` ⇒ brand-new
```

`??` → the [no-digest](#no-digest-before-this-run) case; the whole file is what moved. Otherwise **what moved is
the digest's diff** — `git -C <root> diff generated-docs/design/digest.md`, in the checkout the interpreter wrote
into. An empty diff, or a `not-a-design` verdict → stop: the design you can see hasn't changed.

## Tell the user what moved

Read the digest diff (or the whole file, when brand-new) and say what moved **in your own words** — *"here's
what moved in your design"*. Context only; it doesn't re-scope the epic. Each command says which approval this
rides alongside.

## Recording a `CONFLICT:` answer

Ask *design wins* / *your earlier decision stands*, batched up to four per call. Write the answer into the
digest's **Your Decisions** per
[approval-pattern.md](./approval-pattern.md#recording-a-decision-that-overrides-the-design), which owns the
append-vs-strike rule and the `outcome` / `supersedes` shape, and **clear the `CONFLICT:` uncertainty it
settles**. `/plan` stores the answer in `epic.designDecisions` instead ([Planning ahead](#planning-ahead-plan));
READY-TO-BUILD applies it.

**When applying stored answers, reconcile against the digest as it stands now.** Read **Your Decisions** first
and strike whatever each new decision replaces, stored `supersedes` or not. If a stored `supersedes` names a
bullet that isn't there, append the decision and say: *"I've recorded <new decision>. It was meant to replace an
earlier note — <stored wording> — but that note isn't in your design record, so nothing was removed. If it turns
up later, the two will contradict each other."*

## No digest before this run

Say it alongside what moved: *"Your app is already built, so I'll only change the screens you named — [list them].
Everything else stays as it is. If anything I rebuild should keep its current behaviour instead of matching the
design, tell me and I'll note it."* Record whatever they name. No extra approval or migration step.

## Tests that assert the design being replaced

Earlier epics' tests may encode the *old* design (a test asserting the app is light-only, say) and go red when
the new design lands. Say so in this epic's brief under **Notes & Caveats**: rewrite each such test to assert
the new invariant — never delete it, never weaken it to clear the red.

## What rides the branch

`documentation/`, the digest, the brief, and — when colours moved — `project.md` §Styling. That is one commit.
The token layer is **not** in it:
[Step B0.3](../commands/continue.md#step-b03-design-tokens-when-the-palette-isnt-applied-yet) re-derives it
during BUILD, in its own commit on the same branch. Everything lands on `main` at the merge, and
`git branch -D` discards all of it.

## Planning ahead (`/plan`)

When `/plan` handles a design-update epic
([Step 3b](../commands/plan.md#step-3b-read-the-changed-design-design-update-epic-only)), **nothing of the
design reaches `main`**; READY-TO-BUILD applies it on the build branch. So:

- The interpreter reads the session's live `documentation/` and writes the digest into the worktree. That
  digest is never staged — the plan commit adds its files **by name**.
- Every answer that would go into **Your Decisions** — a `CONFLICT:`, anything named at the no-digest message,
  a §Styling override from a project change — is held in `state.json.epic.designDecisions` as
  `{ outcome, line, supersedes }`, with the superseded bullet's wording quoted at plan time.
- Last thing before the plan commits, run `design-fingerprint.js` from the **session root** (it hashes the
  project it lives in) and store the result in `epic.designFingerprint` — never `null`. READY-TO-BUILD compares
  with `--compare`.
- `epic.parkedDesignUpdate: true` is what makes READY-TO-BUILD run its design step.
