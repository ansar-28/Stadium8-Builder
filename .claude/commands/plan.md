---
description: Plan the next epic ahead, and park it ready to build without starting it. Safe to run in a separate session while another epic is building.
---

Plan the next epic and park it **ready to build**: the full PLAN routine — story breakdown and stories
approval — stopping at `READY-TO-BUILD` for `/start` to build later.

**One window, one command.** All the git work happens in a **throwaway worktree cut from the latest
`main`**, and the finished plan parks back **on `main`**, never a side branch — so it can't go stale, and
running `/plan` never disturbs a build in another window. No `epic/<slug>` branch is created here: `/start`
cuts one fresh at build time, re-checks the parked plan against it, and that branch's `state.json` takes over
([start.md](start.md) Step B2 → [continue.md → READY-TO-BUILD](continue.md#phase-ready-to-build)).

```!
cat "${CLAUDE_PROJECT_DIR}/.claude/shared/orchestrator-rules.md"
```

## Step 0: Check the workspace is safe

1. **Don't interleave with an active flow.** If an in-progress `/start` or `/continue` is already underway in
   *this* session: *"I'm in the middle of \<what\> right now. Open a fresh Claude Code window on this project
   and run `/plan` there — it'll plan the next epic without disturbing this work."* Then resume what you were
   doing (re-surface the approval you were waiting on).

2. **Project must exist.** No `generated-docs/project.md` → *"There's no project set up yet — run `/start` to
   set it up and build the first feature."* Stop.

3. **Otherwise proceed.** `/plan` never touches this window's branch or working tree. Don't ask the user where
   to plan, offer to switch branches, or set up a second folder. (Needs a shared remote — see
   [Notes](#notes).)

## Step 1: Pick the epic to plan

Read readiness and show the recap per the [shared epic picker](../shared/epic-picker.md) — it owns the data
call, the `✓ ▸ ◆ ● ⊘` legend, the `hasPlan: false` fallback, and the up-to-3/ready-first convention. A
startable *draft* is a `ready` or `blocked` epic. Then `AskUserQuestion`:

- **Question:** "Which epic would you like to plan next?"
- **Options:** the draft epics (ordered/labelled per the shared picker), plus "Plan a new one".

Routing:

- **Draft chosen** → set `epicSlug`/`epicName`; take `dependsOn` + `status` from the plan. Its brief already
  exists on `main` — skip to **Step 3**. If the user wants something changed first: this epic's scope → note it
  for the brief revision at Step 3c; a *project* fact → record it as `projectChanges` for Step 3a.
- **Plan a new one** (or no drafts) → Step 2.

## Step 2: Capture a brand-new epic

*(New-epic path only. A chosen draft already has its inputs — skip to Step 3.)*

1. **Describe it.** Ask as plain text: *"What's the next epic, and what does it deliver?"* Capture as
   `epicDescription`; derive `epicSlug` (kebab-case) and `epicName`.

2. **Infer the setup, then confirm it.** Don't interrogate the user. Read `project.md`, `epic-plan.md` and the
   other epics' briefs from **`origin/main`** — `git fetch origin`, then `git show origin/main:<path>` — not
   from this window's disk (Step 3 says why). Work out two things:

   - **Project-level facts.** Does this epic fit the existing roles, auth, backend, compliance and styling,
     or does it *imply* a change to one (a new role, a new auth endpoint, a new compliance obligation, a new
     brand colour)? Most epics fit. Capture any you judge **changed** as `projectChanges` — which fact, and
     the edit you'd make, in the user's terms.
   - **Dependencies.** Which in-flight or planned epics does it build on — shared data models, endpoints,
     screens? The user often won't know reliably, so lead with your own read. Record slugs as `dependsOn`
     ([§6.3](../policies/epic-branch-concurrency.md#63-cross-epic-dependencies)).

   Present the guess as one or two plain sentences — *"This looks like it fits your current setup (same
   roles, auth, backend, compliance, styling) and builds on **\<epic\>** because it needs its \<thing\>. I'll
   plan it against those unless you tell me otherwise."* — then one `AskUserQuestion`, *"Have I got that
   right?"*:

   - **"Yes, plan it"** *(Recommended)* — proceed with the inferred facts + dependencies.
   - **"Dependencies are different"** — free-text which epics it really builds on; update `dependsOn`.
   - **"A project fact changes"** — record it in `projectChanges` for
     [Step 3a](#step-3a-apply-a-project-level-change-only-if-one-is-needed); a palette the user simply *tells*
     you is this case. If instead they edited the design files in `documentation/` and want screens rebuilt
     to match, that's [Step 3b](#step-3b-read-the-changed-design-design-update-epic-only). Either way `/plan`
     carries it — **never send the user to `/start`**.

## Step 3: Open the background worktree

**Blocked epic first** (a dependency not yet merged — a ⊘ draft, or `dependsOn` naming an in-flight epic): tell
the user it can't merge until that dependency does and may need a rebase when built. With that confirmed,
continue.

`git fetch origin`, then check for a leftover `plan/<epicSlug>` branch from an interrupted run:

```bash
git rev-parse --verify --quiet plan/<epicSlug>              # exit 0 ⇒ leftover exists
git merge-base --is-ancestor plan/<epicSlug> origin/main     # only then: 0 ⇒ its work is already on main
```

- **No leftover** → *Create the worktree*.
- **Leftover, already on `main`** → cruft. Say *"cleaning up leftovers from an interrupted run"*, *Remove
  the leftover*, *Create the worktree*.
- **Leftover, not on `main`** → `Read` `../<project>-plan-<epicSlug>/generated-docs/epics/<epicSlug>/state.json`
  (absent counts as empty). A populated `stories` means the plan was finished but never saved — ask: *"Your
  plan for “<epicName>” was finished but never saved. Save it now, or start over?"* On *save*, adopt the
  worktree and go straight to **[Step 5](#step-5-park-it-on-main--the-plan-exit)**. Otherwise (start over,
  or too little approved to keep) say so in one line, *Remove the leftover*, *Create the worktree*.

**Remove the leftover:**

```bash
git worktree remove --force ../<project>-plan-<epicSlug> 2>/dev/null || git worktree prune
git branch -D plan/<epicSlug>
```

**Create the worktree** (post a brief "setting up…"):

```bash
git worktree add -b plan/<epicSlug> ../<project>-plan-<epicSlug> origin/main
```

**`<worktree>` below means `../<project>-plan-<epicSlug>`** — the throwaway directory, removed in Step 5;
`plan/<epicSlug>` is the throwaway branch. Everything from here runs against it: `git -C <worktree> …` for
plumbing, and the worktree path as workspace root for every **read and write** — `project.md`, the digest,
`epic-plan.md`, the other briefs, app code. This window's checkout may be on another epic's branch, so a bare
`Read` or `grep` returns unmerged facts. One exception: Step 3b reads the design from the session's
`documentation/`, where the user's live edits are.

## Step 3a: Apply a project-level change (only if one is needed)

*(Skip when `projectChanges` is empty — the common case. Runs before the brief and the stories, which are
written against `project.md`.)*

1. **Edit `<worktree>/generated-docs/project.md`.** Surgical (a role row, a compliance bullet, a hex) →
   `Edit`. Broader → `intake-agent` `revise` with `target: project.md`, `workspaceRoot: <worktree>` and
   `revisionFeedback: <the change in the user's terms>` — all three required.

2. **Get it approved** per [§6.1 step 3](../policies/epic-branch-concurrency.md#the-main-landing-write-single-developer-default),
   diff inline: `git -C <worktree> diff origin/main -- generated-docs/project.md`. §6.1's two limits apply as
   written.

   **Declined?** Revert it (`git -C <worktree> checkout origin/main -- generated-docs/project.md`), clear
   `projectChanges`, and skip step 3 — Step 3b still runs if it applies.

   **Approved and it touches §Styling?** Record the **Your Decisions** bullet §6.1 step 3 asks for, in the
   worktree's digest — or, on a design-update epic, hold it per
   [Step 3b](#step-3b-read-the-changed-design-design-update-epic-only).

3. **Land it on `main` now**, separately from the plan — a project fact doesn't wait for the epic:

   ```bash
   git -C <worktree> add generated-docs/project.md   # + generated-docs/design/digest.md if step 2 wrote a bullet
   git -C <worktree> commit -m "chore(project): <what changed>"
   git -C <worktree> push origin HEAD:main           # rejected? fetch, rebase, retry
   ```

   Then: *"I've updated your project setup: \<what changed\>. That applies to every epic from here on, and it
   stays even if you never build this one."* Palette change? Add: *"The new colours go in when this epic
   builds."*

## Step 3b: Read the changed design (design-update epic only)

*(Skip unless this epic rebuilds screens against design files the user changed in `documentation/` — they say
so; nothing auto-detects.)* Rules: [design-update.md → Planning ahead](../shared/design-update.md#planning-ahead-plan).

**Nothing of the design lands on `main` here.** The digest is refreshed only in the worktree and never staged,
and every **Your Decisions** bullet this run would otherwise write — at Step 3a, the brief approval, or the
stories approval — is held as an `epic.designDecisions` entry (Step 3c) instead, with the superseded bullet's
wording quoted while the digest is open.

**Refresh the digest from the user's live design into the worktree.** The worktree's `documentation/` is the
design as it *was* — don't read it or copy the folder across:

```
design-interpreter
documentationRoot: <session project root>   # the user's edited design — read-only
workspaceRoot: <worktree>                   # the refreshed digest lands here
timestamp: <ISO 8601 now>
```

Stop per design-update.md on an empty digest diff or a `not-a-design` verdict. The brief must follow the new
design: a new epic's is written against the fresh digest at Step 3c; a draft's is revised there.

## Step 3c: Lay down the plan skeleton

1. **New epic — land the plan row** in `<worktree>/generated-docs/epic-plan.md` (slug, name, goal,
   `dependsOn`), a design-update epic included: a parked epic needs the row for `/status` and the dashboard.

2. **The brief.** New epic → `intake-agent`:

   ```
   mode: epic-only
   workspaceRoot: <worktree>
   epicSlug: <kebab-slug>
   epicName: <human name>
   epicDescription: <free text from Step 2>
   ```

   Draft whose brief needs changing (the user asked at Step 1, or the design moved at Step 3b) →
   `intake-agent` `revise` with `target: brief`, `workspaceRoot: <worktree>`, `revisionFeedback: <what
   changed>`. Any other draft → skip to 4.

3. **Brief approval** per the [Approval Pattern](../shared/approval-pattern.md): `Read` the `BRIEF_FILE` the
   agent names — that's what you show; `<artifact_path>` = the worktree's `brief.md`; revise via the same
   `revise` call; loop until approved. **Design-update epic:** alongside it,
   [tell the user what moved](../shared/design-update.md#tell-the-user-what-moved)
   (`git -C <worktree> diff generated-docs/design/digest.md`), ask any `CONFLICT:` uncertainty, and give the
   [no-digest message](../shared/design-update.md#no-digest-before-this-run) if it applies — answers are held
   for step 5.

4. **Initialise state** at `phase: PLAN`:

   ```bash
   node .claude/scripts/epic-state.js --init \
     --root <worktree> --branch epic/<epicSlug> \
     --name "<epicName>" [--depends-on <dep-slug> ...]
   ```

   `--branch epic/<epicSlug>` (not `plan/`) puts `state.json` at the canonical build-branch path. Verify
   `"status": "initialised"`; on error, STOP, tear the worktree down (Step 5.6), and report.

5. **Design-update epic only** — set three `epic` fields via Edit:

   ```json
   "parkedDesignUpdate": true,
   "designFingerprint": null,
   "designDecisions": [
     { "outcome": "decision-stands", "line": "<the decision, in the user's words>", "supersedes": null },
     { "outcome": "design-wins",     "line": "<what the design now does, in the user's words>",
       "supersedes": "<the existing Your Decisions bullet this replaces, quoted well enough to find it>" }
   ]
   ```

   `outcome` is **required** ([approval-pattern.md](../shared/approval-pattern.md#recording-a-decision-that-overrides-the-design));
   Step 5.2 fills in the fingerprint.

## Step 4: Break the stories down (shared PLAN routine)

Run the story generation + approval from [continue.md → Phase: PLAN](continue.md#phase-plan): `feature-planner`
in `stories` mode, the editable review page, the stories approval — with the planner's `brief`/`project`/
`proposalPath`, the review payload and the review page all under `<worktree>/generated-docs/…`:

```bash
node .claude/scripts/render-stories-review.js --in "<worktree>/generated-docs/epics/<epicSlug>/review-payload.json" --out "<worktree>/generated-docs/epics/<epicSlug>/stories-review.html"
node .claude/scripts/open-page.js "<worktree>/generated-docs/epics/<epicSlug>/stories-review.html"
```

A [bounce-back](../shared/approval-pattern.md#bounce-back-stories-approval-only) that turns out to be a
*project* fact (the roles are wrong, the palette is wrong) → run Step 3a against the worktree and regenerate
the stories; don't send them to `/start`.

**Run only continue.md's "On approval" persistence actions**, written into the worktree — the per-story files,
`state.json.stories`, `epic.introducesSharedSurface`, `epic.unverifiedAssumptions`, and a **Your Decisions**
bullet for any `designChoices` answer (held in `designDecisions` on a design-update epic, per Step 3b). **Not**
the transition to `BUILD`, the commit, or "proceed to BUILD" — Step 5 does those.

## Step 5: Park it on `main` — the `/plan` exit

1. Transition `<worktree>`'s `state.json.phase` from `PLAN` to **`READY-TO-BUILD`** via Edit — *not* `BUILD`.

2. **Design-update epic only — fingerprint the design**, last thing before the commit, from the **session
   root**, not the worktree (the script hashes the project it lives in):

   ```bash
   node .claude/scripts/design-fingerprint.js
   ```

   Write the returned `fingerprint` to `epic.designFingerprint`. On `{"status":"error"}`, stop and remedy —
   never commit it `null`.

3. **Stage the plan by name — never `git add generated-docs/`:**

   ```bash
   git -C <worktree> add generated-docs/epic-plan.md generated-docs/epics/<epicSlug>/
   ```

   Add `generated-docs/design/digest.md` too if Step 4 wrote a **Your Decisions** bullet — never on a
   design-update epic (Step 3b).

4. **Commit:**

   ```bash
   git -C <worktree> commit -m "docs(plan): plan epic <epicSlug> (ready to build)"
   ```

   For a design-update epic, say in the body that the plan was made against the user's updated design, which
   lands with the build.

5. **Land it on `main` through the remote** — never check out `main` here:

   ```bash
   git -C <worktree> push origin HEAD:main
   ```

   Rejected because `main` moved? `git -C <worktree> fetch origin && git -C <worktree> rebase origin/main`,
   resolving per [§6.2](../policies/epic-branch-concurrency.md#62-shared-evolving-artifacts--pr-time-conflict-resolution)
   (two `epic-plan.md` rows: keep both, fix the `#` numbering), then push again.

6. **Finish up** — refresh local `main` so `/status` and the dashboard see the parked epic, remove the
   worktree, regenerate the dashboard:

   ```bash
   git fetch origin main:main   # if THIS window is on main: git merge --ff-only origin/main
   git worktree remove --force ../<project>-plan-<epicSlug> || git worktree prune
   git branch -D plan/<epicSlug>
   node .claude/scripts/generate-dashboard-html.js
   ```

7. Tell the user and **stop** — do **not** chain into building:

   > *“<epicName>” is planned and ready to build. Your plan won't go out of date however long you leave it —
   > when you build it, it picks up everything else that's finished in the meantime.*
   >
   > *Build it with `/start` and pick it from the list. To plan another epic instead, open a new window and
   > run `/plan` there.*

   **Design-update epic** — add this line exactly: *"I planned these stories against your updated design.
   Your design files are exactly where you left them — I'll build the screens from them when this epic
   builds, and they become part of your app once the epic is merged."*

## Notes

- **No remote → single session only.** Read local `main` wherever this says `origin/main`, skip every
  `fetch`/`push`, and land each push as `git branch -f main plan/<epicSlug>` (a fast-forward — the worktree
  was cut from there). Per [§6.1](../policies/epic-branch-concurrency.md#61-project-level-changes).
