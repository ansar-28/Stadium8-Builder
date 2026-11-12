---
description: Continue the workflow — drives PLAN, BUILD, EPIC-END, MANUAL-TEST, and COMPLETE-ON-BRANCH for the current epic.
---

Continue the epic-branch feature workflow. `/start` runs INTAKE through the INTAKE approval and chains here; `/continue` can also be invoked directly to resume after a session break.

```!
cat "${CLAUDE_PROJECT_DIR}/.claude/shared/orchestrator-rules.md"
```

## Execution Model

`/continue` is parent-driven. Resolve the active state file, determine the current phase, execute its instructions directly. Launch work agents via `Agent` with the named subagent_type. Present approvals via `AskUserQuestion`.

State lives in `generated-docs/epics/<slug>/state.json` on the `epic/<slug>` branch and is authoritative; the orchestrator re-enters at whatever phase it shows.

## Phase Flow

```
PLAN → BUILD → EPIC-END → MANUAL-TEST → COMPLETE-ON-BRANCH → COMPLETE
       ⛳ stories approval  (/quality-check + /code-review --fix + Playwright)  ⛳ manual-test approval   (PR + merge)
```

| Phase | What runs | Approval |
|---|---|---|
| PLAN | `feature-planner` (stories for this epic) | Stories approval |
| READY-TO-BUILD | Parked on `main`: `/plan` stops here after the stories approval; `/start` cuts a fresh branch from `main` and resumes into BUILD | None |
| BUILD | `test-generator` batched up front (all stories), then per story: `developer` → inline light gate (lint + test-quality) → commit | None (autonomous within the epic) |
| EPIC-END | full `/quality-check` (run inline) → `code-review-runner` runs `/code-review --fix` over the epic diff → `playwright-runner` batched across all the epic's specs against the production build, each with a fix cycle | None |
| MANUAL-TEST | Per-story manual checklists | Manual-test approval |
| COMPLETE-ON-BRANCH | `gh pr create` → CI wait → user-approved merge → branch cleanup | User-approved merge |
| COMPLETE | Frozen historical record on main | — |

---

## Step 1: Read State

Resolve the state file via:

```bash
node .claude/scripts/resolve-state-path.js
```

Parse the JSON:

- **`kind: "epic"`, `exists: true`** → `Read` `state.json` **fresh from disk** — even if you read it earlier in this conversation, since another window may have advanced the phase. Identify `phase`, then run **Step 1a** before anything else.
- **`kind: "epic"`, `exists: false`** → state file missing on this branch. Tell the user: *"I can't find any record of the work in progress here. Run `/start` to set it up again."* Stop.
- **`kind: "none"`** → there's no epic on this branch. Go to **Step 1b**.

### Step 1a: Confirm before resuming a build

Run this before the id backfill and the §6.1 sync below.

| Epic state | Prompt? |
|---|---|
| `BUILD` or `EPIC-END`, no halt recorded | **Yes** |
| `BUILD` or `EPIC-END` with a halt — `state.json.halt` set, or a story at `status: "halted"` | No — nothing is running; re-surface the halt |
| Any other phase | No |

When it applies, ask with `AskUserQuestion`:

- **Header:** "Mid-build"
- **Question:** "**[Epic name]** is part-way through being built. If another window is still working on it, continuing here could overwrite that work. Continue anyway?"
- **Options:**
  - **"Continue"** — shown as *"Pick up building [epic name] in this window."* Proceed with the rest of Step 1.
  - **"Stop — I'll check first"** — shown as *"Nothing is changed. Check for another window on this project, then run /continue again."* End `/continue`: no `state.json` edit, no rebase, no push, no phase change.

**Id backfill (one-off).** If this epic's `epic.epicId` is missing, or any `stories[<N>]` entry lacks a `storyId`, mint the missing ids via Edit. Generate them in **one** call — `node -e "for (let i = 0; i < <count>; i++) console.log(require('node:crypto').randomUUID())"` with `<count>` = the number of missing ids — and transcribe one per field; never write a UUID by hand or reuse one across fields. Ids are minted once and never regenerated: they identify the epic and story in the Stadium Builder build-metrics store, and a re-mint restarts that work's accumulated totals from zero under new rows. The edit rides the next state commit. This covers in-flight epics that predate the fields — only the epic `/continue` is driving; epics already at `COMPLETE` stay as they are, having no metrics history for an id to attach to.

**Sync with `main` (§6.1 checkpoint).** On entry, run the [§6.1 checkpoint](../policies/epic-branch-concurrency.md#61-project-level-changes): with a remote and a clean tree, `git fetch origin`, and when `epic/<slug>` is behind `origin/main`, `git rebase origin/main` (conflicts per §6.2) then `git push --force-with-lease origin epic/<slug>` if the branch was pushed (the rebase rewrote its SHAs). Skip silently when there's no remote, the working tree is dirty, or the branch is already current. If the advance changed a `project.md` fact this epic relied on, surface a one-line note; if it changed **§Styling**, re-run [Step B0.3](#step-b03-design-tokens-when-the-palette-isnt-applied-yet) before the next component is written.

**Refresh the dashboard.** Once state is resolved, regenerate the dashboard so it reflects the current phase — this replaces the `/start` start-up snapshot and re-freshes on every resume (fire-and-forget, per the [Dashboard Update Policy](../shared/orchestrator-rules.md#dashboard-update-policy)):

```bash
node .claude/scripts/generate-dashboard-html.js
```

Then jump to the phase section below matching `state.json.phase`.

### Step 1b: No epic on this branch — report where the project stands

**If there is no `generated-docs/project.md`,** nothing is set up here — say one of these and stop:

- Legacy files present (`generated-docs/context/workflow-state.json`) → *"This project was set up with an older version of the workflow. Run `/migrate-legacy` to bring it up to date."*
- Otherwise → *"There's no project here yet. Run `/start` to set one up."*

**Otherwise, report where the project stands.** **Never start a build** — `/start` is the only command that does that.

```bash
node .claude/scripts/collect-dashboard-data.js --format=text
```

Print that output as-is. Then say in a line or two what the user can pick up and how: a `git checkout` for an epic that has a branch, `/start` for one that is parked. **Never offer a checkout for a parked epic — it has no branch.**

Then stop.

---

## Phase: PLAN

PLAN runs once per epic: `feature-planner` produces stories for the current epic, the orchestrator gates on user approval, BUILD begins. There is no epic-list sub-phase — each epic is its own `/start` invocation per the epic-branch workflow.

### Step P1: Generate Stories

Invoke `feature-planner` in `stories` mode (decompose mode is the INTAKE-time epic-plan step, not this per-epic one):

```
Agent: feature-planner
mode: stories
brief: generated-docs/epics/<slug>/brief.md
project: generated-docs/project.md
proposalPath: generated-docs/epics/<slug>/stories-proposal.md
```

Wait for return — four lines (`PROPOSAL_FILE` / `MODE` / `STATUS` / `COUNTS`), not the proposal. **`Read` the `PROPOSAL_FILE`** before P2; it's your only copy of the plan, and everything below reads from it. On each revision the agent overwrites the same file, so re-read it after every re-invoke, and don't paste the proposal back into its prompt — it reads its own file. The file is regenerable and gitignored; nothing commits it.

The proposal holds story details (`plainSummary`, `acceptanceCriteria` as `{ id, text, coverage }` objects, `manualTestChecklist`, `additionalTechnicalChecksCount`, `isInfrastructureOnly` per story), epic-level `epicIntroducesSharedSurface`, `unverifiedAssumptions` (epic-level; the real-backend assumptions surfaced first at the manual-test approval — often `[]`), `infrastructureReuseNotes`, and `designScreens`. The epic's `nonGoals` come from `brief.md`. The `coverage` tags are **agent-internal** — they are not shown at the approval.

### Step P2: Stories Approval

Display the headline as conversation text — the epic name, its goal, and one line per story (the planner applied its [Translation Rule](../agents/feature-planner.md#translation-rule) to produce these strings; render them verbatim):

```
## Epic - [name]

[one-line epic goal]

[For each story in order — append "(under the hood)" when its `isInfrastructureOnly` is true:]
1. [Story Title]
2. [Story Title]        (under the hood)
3. [Story Title]

I've opened the full plan in your browser. Change anything you like there, then click
Approve — it copies your version for you to paste back here. If it's good as it stands,
just answer below.
```

Everything else is on the review page only: plain summaries, acceptance criteria, manual tests and non-goals. The technical-check count (`additionalTechnicalChecksCount`) and the design reference are shown nowhere — neither is a decision. Nor is the technical detail (`acceptanceCriteria` with coverage tags, `requirementIds`, `targetFile`, `slug`, `summary`, `infrastructureReuseNotes`), which goes to `generated-docs/epics/<slug>/stories/story-<N>-<slug>.md` for the agents.

**Open the editable review page.** Build the payload from the `STORIES PROPOSAL` per the [Editable HTML Review Page](../shared/approval-pattern.md#editable-html-review-page-plan-approvals) rules (which decide what goes in it — especially which `designChoices`, if any, genuinely need the user), then render and open it:

```bash
node .claude/scripts/render-stories-review.js --in "generated-docs/epics/<slug>/review-payload.json" --out "generated-docs/epics/<slug>/stories-review.html"
node .claude/scripts/open-page.js "generated-docs/epics/<slug>/stories-review.html"
```

The page resolves the **same** approval as the AUQ below — the user edits on the page and clicks **Approve** (auto-copies `{ decision: "stories", edited, epic, name, summary, stories, nonGoals, designChoices }` to paste back) or answers in chat. On script failure, output a one-liner and fall back to the in-chat approval.

Then `AskUserQuestion`:

- **Question:** "Ready to build [epic name]?"
- **Options:**
  - "Approve" — kick off BUILD
  - "Adjust the stories" — free-text deltas
  - "Abandon this epic" — delete the branch, return to main

**Revision flow:** invoke `feature-planner` with `revisionFeedback`. Loop until approved or abandoned.

**Pasted `{ decision: "stories", edited, ... }` from the page:** if `edited: false` (or the user typed `approved`), treat as *Approve* with the proposal as-is. If `edited: true`, apply the user's edited `stories` array (order, titles, summaries, acceptance criteria, manual tests) and `nonGoals` as the approved content — then proceed to **On approval**. A structural change that needs re-planning (a split/added story lacking acceptance criteria) routes back through `feature-planner` `revisionFeedback` first.

**Always fold the pasted `designChoices` into the per-story context the developer receives**, whichever branch you took — the answers travel on every hand-off, not only an edited one (record a spec-gap resolution or cross-epic convention in the epic's `brief.md`, or `project.md` if project-wide; a choice that answers a design-digest Uncertainty also goes in the digest's **Your Decisions** section — step 1 below).

**On approval:**

1. Write per-story files: `generated-docs/epics/<slug>/stories/story-<N>-<slug>.md` for each story. Each file carries title, summary, requirementIds, roles, route, targetFile, pageAction, `acceptanceCriteria` (the `{ id, text, coverage }` list with tags intact), plainSummary, manualTestChecklist, isInfrastructureOnly, and any **resolved design choices** for the story's screen (the user's `designChoices` selections — so the developer builds to the decision instead of re-reading it as an open digest uncertainty).

   **Also record any answered design uncertainties.** For each `designChoices` selection that resolved an open Uncertainty from `generated-docs/design/digest.md`, append a bullet to that file's **Your Decisions** section per [approval-pattern.md § Recording a decision that overrides the design](../shared/approval-pattern.md#recording-a-decision-that-overrides-the-design) — so the next read of the design doesn't re-ask it or build past it. Skip when there's no digest or no such choice. Append only; never touch the rest of the digest from an epic branch.
2. Initialise `state.json.stories[<N>]` entries via Edit: `{ storyId: "<fresh UUID>", status: "pending", e2eStatus: "deferred", startedAt: null, completedAt: null }` for each story. Mint the ids in **one** call — `node -e "for (let i = 0; i < <storyCount>; i++) console.log(require('node:crypto').randomUUID())"` — and transcribe one per story; never write a UUID by hand or reuse one across stories. An entry that already has a `storyId` keeps it: like `epic.epicId`, a `storyId` identifies the story in the Stadium Builder build-metrics store and is never regenerated. Set `state.json.epic.introducesSharedSurface` to the planner's `epicIntroducesSharedSurface` boolean (the per-epic baseline trigger; read at B1). Set `state.json.epic.unverifiedAssumptions` to the planner's `unverifiedAssumptions` array (`[]` when none) — read back at the manual-test approval (B7.1).
3. Transition `state.json.phase` from `PLAN` to `BUILD` via Edit. (`/plan` instead transitions to `READY-TO-BUILD` and stops — see that phase below.)
4. Commit (on the epic branch):

```bash
git add generated-docs/epics/<slug>/
# Stage the digest so a Your Decisions entry from step 1 rides this commit. Guarded because most
# projects have no digest, and `git add` fails (exit 128) on a path that doesn't exist. No-op if unchanged.
[ -f generated-docs/design/digest.md ] && git add generated-docs/design/digest.md
git commit -m "docs(plan): stories for epic <slug>"
git push origin HEAD
```

5. Proceed to BUILD phase.

---

## Phase: READY-TO-BUILD

A **parked** epic, planned by `/plan`. [`/start`](start.md) Step B2 has just cut `epic/<slug>` from the current
`main`, and the parked plan came with it. On pickup:

1. **Re-check the parked plan against this fresh `main`.** The branch is cut from current `main`, so the *code* context is already up to date — but the stories may have been written several epics ago. Scan for drift the plan assumed away: shared components/utilities, API endpoints or the generated spec, design tokens, or `project.md` facts that changed since the plan was parked. If nothing material changed, say so in one line and continue. If a story now clashes with what's on `main` (e.g. it plans a component a later epic already built), note it plainly and offer to adjust **only the affected stories** via `feature-planner` `revisionFeedback` before building — a light re-plan, not a redo of the whole epic.
2. **Design-update epic only** (`state.json.epic.parkedDesignUpdate` is `true`; skip otherwise) — apply the
   design on this branch. The user's edited `documentation/` came across with the checkout. Rules:
   [design-update.md](../shared/design-update.md).

   **Already applied?** An interrupted pickup re-enters here:

   ```bash
   git diff --quiet origin/main HEAD -- documentation/ generated-docs/design/   # no remote: main
   ```

   Non-zero exit → (c) already committed the design on this branch; skip to step 3.

   a. **[Refresh the digest](../shared/design-update.md#refresh-the-digest-on-the-branch)** against the
      current `documentation/`. Note `COUNTS: conflicts=<N>` for (c). Don't re-show the digest diff.

   b. **Check the design is still the one the user approved:**

   ```bash
   node .claude/scripts/design-fingerprint.js --compare <state.json.epic.designFingerprint>
   ```

   - **`match: true`** → *"Your design is unchanged since you planned this epic."* Continue.
   - **`match: false` and `changed` names only non-design files** (an API spec, a sample CSV) → say their
     design didn't move, a project document did. Continue.
   - **`match: false` otherwise** → say what moved, from `changed` (or, given `changedUnavailable`, that
     something under `documentation/` changed but you can't say what), then `AskUserQuestion` — *"Your
     design has changed since you planned this epic, so the stories were written against the earlier
     version. What would you like to do?"*: **"Adjust the affected stories first"** *(Recommended)* — the
     light re-plan in step 1, then continue; **"Build the stories as approved"** — continue; anything the
     newer design moved outside these stories waits for a later epic.

   c. **Apply the plan-time answers, then settle what's still open, then commit:**

   - **First**, apply each `state.json.epic.designDecisions` entry per
     [design-update.md](../shared/design-update.md#recording-a-conflict-answer), honouring its `outcome`,
     and clear the `CONFLICT:` uncertainties it resolves. Don't re-ask these.
   - **Then** ask and record any `CONFLICT:` still standing, per the same section — those are new since plan time.

   A palette change rides this branch ([what rides the branch](../shared/design-update.md#what-rides-the-branch));
   Step B0.3 re-derives the tokens. Then:

   ```bash
   git add documentation/ generated-docs/design/   # + generated-docs/project.md if §Styling changed
   git commit -m "docs(<slug>): update design source"
   ```

   "Nothing to commit" must not happen here. If it does,
   check `git diff --stat origin/main HEAD -- documentation/ generated-docs/design/` and say what you find
   before continuing.

3. Transition `state.json.phase` from `READY-TO-BUILD` to `BUILD` via Edit.
4. Proceed to the BUILD phase below; B0 through B0.3 run as for any epic.

---

## Phase: BUILD

Per story in the current epic, run the BUILD loop. Each story is a sequential mini-pipeline. The orchestrator is on the `epic/<slug>` branch; state lives in `generated-docs/epics/<slug>/state.json`.

**Output to user, once on entering BUILD:** `Building <Epic name> — <N> stories.`

### Step B0: Epic mock-data bootstrap (once, before the first story)

Before the per-story loop, generate the epic's **shared** mock data so both test layers import one source instead of authoring divergent response bodies (the cause of the v07 nav-gating drift, where Vitest and Playwright disagreed on the `userinfo` shape). Run **once** when BUILD is first entered for the epic; it's idempotent, so a resumed BUILD re-runs it harmlessly. Skip only when the epic has no API-backed behaviour at all.

Determine the entities this epic touches — from the brief's Data Model plus the entities the epic's story `targetFile`s consume — and whether auth is in scope (`project.md` §Authentication ≠ "no auth"). If the epic uses a generated API spec, first run `design-api-agent` (it creates the spec on the first epic and extends it on later ones — see its Step 1) then `type-generator-agent` to refresh `web/src/types/api-generated.ts`. Skip both when this epic adds no new endpoints (the spec is already current); keeping it current here is what lets B0.1's reconcile find this epic's new endpoints. This `design-api` run is **silent** (no approval step) — its audit trail is the spec commit and the endpoints' `x-source: agent-inferred` tags. For the *user*: when `design-api-agent` reports agent-inferred endpoints (`[K] > 0`) **and** `dataSource` is `new-api` or `api-in-development`, append **one** rolled-up line (deduped) to `state.json.epic.unverifiedAssumptions` via Edit — e.g. *"This epic's API spec includes N agent-inferred endpoint(s); confirm they match your real backend."* — so the user confirms them at the manual-test approval. Skip the note for `mock-only` (no backend to verify against). The factories anchor to those generated types, or to the brief's Data Model when there's no generated spec. Then invoke:

```
Agent: test-generator
mode: epic-mocks
epic: <index + slug>
entities: [<entity names>]
authInScope: <bool>
```

The agent ensures `web/src/mocks/data/<entity>.ts` (a `create<Entity>` factory per entity) and — when `authInScope` — `web/src/mocks/data/identity.ts` (`userInfoFor(role)`) exist and are current (creating missing, **extending** changed, never duplicating — entity factories are project-wide and shared across epics). It writes no test files and returns a one-line `MOCK DATA READY` count. These factories are committed with the first story (Step B5's `git add web/src/` covers `web/src/mocks/`).

### Step B0.1: Runtime mock layer (when the data source needs one)

When `project.md` §Data Source records `dataSource` as `mock-only` or `api-in-development`, the running app must serve generated mocks (no real backend is available), so generate the MSW runtime layer. Run **after** Step B0 so the entity factories — and the spec/types — already exist for the handlers to compose. **Skip** for `existing-api` / `new-api` — both have a real backend the app talks to directly (see the `dataSource` matrix in `start.md`).

Invoke `mock-setup-agent` after `epic-mocks` returns:

```
Agent: mock-setup-agent
dataSource: <mock-only | api-in-development>
```

The agent self-derives initial vs reconcile from whether `web/src/mocks/handlers.ts` exists (its Step 2) — no `mode` is passed.

- **First epic (no `web/src/mocks/handlers.ts`):** the agent runs Call A (handlers) **and** Call B (browser infrastructure — `browser.ts`, `MockProvider`, layout wrap, `msw init`).
- **Later epic (`handlers.ts` exists):** Call A only, in reconcile mode — it **appends** handlers for this epic's new endpoints and leaves existing handlers as-is (mechanic in mock-setup-agent Step 2). Call B is already done — it is not repeated.

The generated files live under `web/src/mocks/` and `web/public/mockServiceWorker.js`; they're committed with the first story (Step B5).

### Step B0.2: Batch test generation (once — all stories, before the per-story loop)

Generate **every** story's tests up front in one parallel batch, then run the developers sequentially. All test files are distinct paths (`epic-<slug>-story-<N>-…`), the story specs are fully defined at PLAN time, and the shared mock data already exists (B0) — so there's no per-story dependency and no author-race, and test generation comes off the per-story critical path. Run **once** when BUILD is first entered. On a resume where no story has started yet (every `startedAt` in state.json is null), resume the batch's agents if they can still be reached; otherwise re-run the whole batch, overwriting any test files already on disk.

For each story in the epic, launch one `test-generator` call (it writes both test files), all stories as one Task batch:

```
Agent batch (per story N):
  - subagent_type: test-generator
    mode: story
    story: <story N metadata incl. acceptanceCriteria with coverage tags>
    epicIntroducesSharedSurface: <state.json.epic.introducesSharedSurface AND N is Story 1>
```

Pass `epicIntroducesSharedSurface: true` only for **Story 1** (and only when the epic flag is set); `false` everywhere else. Await all. Both files import the epic's shared mock data from `web/src/mocks/data/` (B0) — they must not author their own response bodies; that single source is what keeps the Vitest and Playwright layers from drifting.

**Collect per story:** the generated test paths (become each story's `testPaths` at B3) and Story 1's `BASELINE:` path if its call wrote one (carried into that story's B5 `changedFiles`).

**Handling a `NOTE:` line.** Any `test-generator` call can return one — the B0 mock bootstrap, this batch, a B2 regeneration, a missing-spec re-run, or the contract-correction re-run at Step B7.1 (2c). The agents never edit `brief.md` themselves. Route the note per [agent-autonomy.md § Brief Drift Handling](../shared/agent-autonomy.md#brief-drift-handling): a **factual gap** is Tier 2 — update the epic's `brief.md` inline and journal it; a **ceiling breach** is the per-epic baseline outgrowing one file — journal it and carry on; anything else, judge it on the same table. In this batched step, apply the notes once **after every call is back**, deduping repeats.

**Idempotent / resumable:** skip any story whose test files already exist at the Rule 10 paths (`web/src/__tests__/integration/epic-<slug>-story-<N>-<title>.test.tsx` and, when routable, `web/e2e/epic-<slug>-story-<N>-<title>.spec.ts`).

**Missing-spec check (batched):** for every routable story (`route !== null`) whose `test-generator` did NOT produce a Playwright spec at its Rule 10 path, resolve it here: regenerate the offenders in one batch, and if any spec is still missing, write it yourself from the story's `route` and `acceptanceCriteria`, per Rule 9 and [testing-policy.md](../policies/testing-policy.md). Mark a story non-routable only if it turns out to have no page to drive.

### Step B0.3: Design tokens (when the palette isn't applied yet)

The `developer` derives the token layer in `globals.css` from `project.md` §Styling & Branding
([styling-centralisation.md](../policies/styling-centralisation.md#build-stage-behaviour--developer-agent)).
Run this check before the first story writes components, and again whenever §Styling changes on this branch.
Cheapest first:

1. **§Styling is all `[DEFAULT]`** → skip: *"No brand colours set, so the app uses the default theme."*
2. **The stamp at the top of `globals.css`'s token block** (§Styling's lines, verbatim) **differs from
   §Styling now** → have the `developer` re-derive the token layer per the policy; no approval needed.
   **Matches** → skip: *"Your brand colours are already applied."*
3. **No stamp:**
   - Values are still the starter's defaults (`oklch` greyscale — chroma and hue both `0`) → derive, as in 2.
   - Real colours → don't regenerate. Write §Styling's current lines in as the stamp and say in one line that
     you've assumed the colours already in the app are the current ones.

**The first time tokens are derived on an existing app**, tell the user: *"Your brand colours are set up now.
A few of the older screens have colours written into them directly, so those won't have changed — I'll switch
them over as I touch them."* Then do that as you touch them.

### Step B1: Read Current Story

The "current story" is the one in `state.json.stories` with `status: "in-progress"`, or — if none — the lowest-indexed story with `status: "pending"`. Read its metadata (title, summary, requirementIds, roles, route, targetFile, pageAction, `acceptanceCriteria` with `{ id, text, coverage }` tags) from `generated-docs/epics/<slug>/stories/story-<N>-<slug>.md`. Also read `state.json.epic.introducesSharedSurface` and note whether this is **Story 1** of the epic (lowest index) — together they drive the per-epic baseline in B2. Mark the story `status: "in-progress"` in state.json via Edit — and if its `startedAt` is null, set it to the current ISO-8601 UTC time in the same edit (never overwrite an existing `startedAt`; a resume keeps the original). Then regenerate the dashboard (fire-and-forget, per the [Dashboard Update Policy](../shared/orchestrator-rules.md#dashboard-update-policy)) so it shows the story as in progress:

```bash
node .claude/scripts/generate-dashboard-html.js
```

### Step B2: Confirm the story's tests

The story's Vitest + Playwright files were generated up front in the **B0.2 batch**. Confirm they exist at the Rule 10 paths (see [naming-conventions.md](../shared/naming-conventions.md)) and set them as `testPaths` for B3.

If they're missing — a resume that skipped B0.2, or a batch gap for this story — regenerate just this story now with the same `test-generator` call as B0.2, applying the same missing-spec check to the result. Carry any Story-1 `BASELINE:` path into B5's `changedFiles`.

### Step B3: developer

```
Agent: developer
story: <metadata>
testPaths: [<vitest paths>, <playwright path>]
cycleNumber: 1
```

The agent reads `project.md` + the epic's `brief.md` + `generated-docs/architecture.md` (the reuse registry), reads the story's screen entry in the design digest (`generated-docs/design/digest.md`) when available, implements code, runs `(cd web && npm test)`, returns `DEVELOPER COMPLETE` or `HALT` or `DEVELOPER UNABLE TO RESOLVE`.

**On `HALT`:**
- **If `requiresProjectChange: true`:** execute the project-change flow per [epic-branch-concurrency.md §6.1](../policies/epic-branch-concurrency.md#61-project-level-changes). The halt is resolved by the project.md edit landing on main; re-invoke the developer with updated context.
- **If `halt.category === "undocumented-endpoint"`:** the developer wants an endpoint / query param / header / request-body shape the OpenAPI spec doesn't document (per [agent-autonomy.md](../shared/agent-autonomy.md) — "API contracts — undocumented usage"). Write what the app needs and what the spec is missing in the user's own terms — never the block — then `AskUserQuestion` with this four-option menu:
  1. **Add to spec, proceed** — ask the user to paste the operation (path, method, params/headers/body). Add it to the canonical spec (`generated-docs/specs/api-spec.yaml`); when there is no canonical spec, record the operation in `generated-docs/architecture.md` under **Cross-epic debt** instead. Commit it, and re-invoke the developer with `priorFailures.endpointInvention: { resolution: "add-to-spec", details: <what was added> }`.
  2. **Use a documented alternative** — re-invoke the developer with `resolution: "documented-alternative"` and the user's guidance (e.g. "list all then filter client-side") so it works within the existing contract.
  3. **Defer this story** — via Edit, set `stories[<N>].status = "halted"`, `stories[<N>].blockedReason = <spec-gap one-liner>`, and `stories[<N>].e2eStatus = "deferred"`. Update those fields in place; don't replace the entry, or `storyId` and `startedAt` go with it. BUILD moves on to the next pending story. The deferred story re-surfaces on the next `/continue`.
  4. **Acknowledge undocumented extension, proceed with audit trail** — re-invoke the developer with `resolution: "acknowledged-extension"`; the developer proceeds and the orchestrator records the acknowledged extension in `generated-docs/architecture.md` under **Cross-epic debt** (the spec gap to close later — one line: endpoint/param/header, and that the user acknowledged it), so future agents and reviewers see it.
- **Otherwise:** present it, then resume BUILD with the user's chosen option as additional context in a re-invocation.

**On `DEVELOPER UNABLE TO RESOLVE`:** treat as fix-cycle failure (Step B6).

### Step B4: Light quality gate (inline)

There is **no per-story review agent** — the substantive code review runs once at epic-end over the whole epic diff (Step B7.0.5). Per story, run only the fast deterministic gate yourself, inline (one call, no subagent): the developer already ran the full Vitest suite + a source-only `tsc` (its `testVerification`), so all that's left is lint + test-quality. (The developer's typecheck is source-only — `tsconfig.precommit.json`, test layers excluded — because during BUILD the batch-generated specs for not-yet-built stories are deliberately TDD-red; the full `tsc` incl. test layers runs at the epic-end quality-check (Step B7.0) and CI.)

```bash
node .claude/scripts/quality-gates.js --auto-fix --checks lint,test-quality --json
```

The script re-execs itself into `web/`, so run it from the repo root as written. Read the JSON:

| `overallStatus` | Next step |
|---|---|
| `pass` | B5 — commit |
| `fail` (lint and/or test-quality) | B6 — fix cycle, passing the failing gate's errors |

`--auto-fix` runs `format` + `lint:fix` first; anything it changes appears in `autoFixResults.changedFiles` and is picked up by B5's `git add web/src/ web/e2e/ …`. Build, TypeScript, full Vitest, and security are **not** run per story — they're the epic-end full quality-check (Step B7.0) plus CI.

If the gate **script itself** misbehaves (a false verdict, a crash — a template-tooling bug, not your app legitimately failing the gate), append an entry to `generated-docs/template-feedback.md` (create if absent, using the entry shape in [agent-autonomy.md § template-feedback](../shared/agent-autonomy.md#generated-docstemplate-feedbackmd--maintainer-channel)); the B5 commit stages it via its existing `[ -f generated-docs/template-feedback.md ] && git add` line.

(`playwright-runner` is **not** invoked per story — Playwright runs once at epic-end in Step B7.0.6. The Playwright spec from B0.2 is generated but not yet executed.)

### Step B5: Commit

**Before staging:** append the developer's `tier2JournalEntries` to `generated-docs/epics/<slug>/journal.md` under the current story's heading. Merge any `unverifiedAssumptions` from the developer's return into `state.json.epic.unverifiedAssumptions` (dedupe) so they float at the manual-test approval. The developer's `architecture.md` / `brief.md` / `template-feedback.md` edits were made **inline** — they just need staging (next). Tier 1 decisions stay in the commit body only.

**Update state.json** via Edit: set `stories[<N>].status = "complete"`, `stories[<N>].e2eStatus = "deferred"`, and `stories[<N>].completedAt = <current ISO-8601 UTC time>` (with `startedAt`, this gives reporting a per-story time window). The story's commit SHA is **not** stored — every reader derives it from the `feat(<slug>/story-<N>)` convention instead (the PR body at B7.2.2, the build report's swimlane), which avoids the placeholder/amend dance and keeps git as the single source of truth for commit identity.

**Commit on the epic branch** — apply the commit/push preference gate ([orchestrator-rules.md §Git Commit & Push Authorization](../shared/orchestrator-rules.md#git-commit--push-authorization)) to the `git commit` and `git push` below:

```bash
git add web/src/ web/e2e/ generated-docs/epics/<slug>/
# Project-wide registry / template-feedback, staged only if this story touched them (missing file → skip, never fatal):
[ -f generated-docs/architecture.md ] && git add generated-docs/architecture.md
[ -f generated-docs/template-feedback.md ] && git add generated-docs/template-feedback.md
# MSW service worker (generated by the runtime mock layer at B0.1, outside web/src/):
[ -f web/public/mockServiceWorker.js ] && git add web/public/mockServiceWorker.js
# Design digest — modified only when a Your Decisions entry was recorded (e.g. the B7.1 fix cycle, step 4a):
[ -f generated-docs/design/digest.md ] && git add generated-docs/design/digest.md
# Transcript-collection id:
[ -f transcript-collection.json ] && git add transcript-collection.json
git commit -m "$(cat <<'EOF'
feat(<slug>/story-<N>): <story title>

[Developer's commit body — Tier 1 decisions, brief updates, key choices]

Co-Authored-By: <the model you are running as> <noreply@anthropic.com>
EOF
)"
git push origin HEAD
# Refresh the dashboard so the story count advances (gitignored — not part of the commit).
node .claude/scripts/generate-dashboard-html.js
```

**Output to user (one line):**

```
Story <N> of <totalInEpic> built. Next: <next story title>.
```

Then loop back to Step B1 with the next story.

### Step B6: Fix Cycle

Re-invoke `developer` with the light gate's failing checks. (Playwright failures don't surface here — they surface at epic-end in Step B7.0.6.)

```
Agent: developer
story: <metadata>
testPaths: [<vitest paths>, <playwright path>]
priorFailures: {
  qualityGate: <the failing lint / test-quality errors from the B4 JSON>
}
```

After developer returns, re-run **Step B4** (the inline light gate). Cap **delegated** fix cycles at 3; past that, fix it yourself, re-running Step B4 each time.

(Fix-cycle count is tracked via the number of B4 runs for this story — not persisted in state.json.)

### Step B7: Epic Complete

When the last story in the epic finishes B5, the epic moves to its end-of-life gates: full quality-check, code review, batched Playwright, manual test, PR + merge.

#### Step B7.0: Epic-end full quality-check

Transition `state.json.phase` from `BUILD` to `EPIC-END`. **Output to user:** `Running the final checks on <Epic name>.` The per-story light gate (Step B4) runs only `lint` + `test-quality`; build, TypeScript, full Vitest, and security are deferred to here. Before code review or E2E, run the complete `/quality-check` suite once across the whole epic — inline, the same way as the per-story light gate (Step B4) and the `/quality-check` command, no subagent:

```bash
node .claude/scripts/quality-gates.js --auto-fix --json
```

This is the full suite (Security; Code Quality incl. **build** + TypeScript; Testing incl. full Vitest + test-quality) — the same checks as `/quality-check`. The script re-execs itself into `web/` and returns compact JSON (per-check output is truncated), so it's safe to run inline from the repo root. Its `build` check produces `web/.next` — **the production build the epic-end Playwright step (B7.0.6) later serves with `next start`**, so a build failure is caught here, with clean story attribution, and E2E never runs against a broken or missing build.

If the gate **script itself** misbehaves (a false verdict or a crash — a template-tooling bug, not the app legitimately failing), append an entry to `generated-docs/template-feedback.md` (create it if absent, using the entry shape in [agent-autonomy.md § template-feedback](../shared/agent-autonomy.md#generated-docstemplate-feedbackmd--maintainer-channel)) and stage it with the next commit below.

Read the JSON's `overallStatus` and `gates`:

- **All gates pass** (`overallStatus: "pass"`). If `autoFixResults.changedFiles` is non-empty, the `--auto-fix` modified files — commit them on the epic branch first:

```bash
git add web/src/ web/e2e/ generated-docs/epics/<slug>/
[ -f generated-docs/architecture.md ] && git add generated-docs/architecture.md
[ -f generated-docs/template-feedback.md ] && git add generated-docs/template-feedback.md
git commit -m "chore(<slug>): apply epic-end quality auto-fixes"   # also covers any template-feedback logged above
git push origin HEAD
```

(If `changedFiles` was empty but you logged `templateFeedback`, still commit — the message can be `chore(<slug>): log template feedback`.)

  Then proceed to **Step B7.0.5** (epic-end code review) — the phase stays `EPIC-END` until every end-of-epic gate is clean.

- **Any gate fails** (`overallStatus: "fail"`). Route it through the fix cycle: attribute the failure to a story (the failing file/error points at the story whose `changedFiles` it touches; where it points at no single story, fix it yourself), re-invoke `developer` for that story with `priorFailures.qualityGate: <the failing gate's errors from the JSON>`, then re-run **this step** to confirm green. Cap **delegated** cycles at 3; past that, fix it yourself, re-running this step each time.

#### Step B7.0.5: Epic-end code review

Gates are green — now run the substantive review **once** over the whole epic's changes (its branch diff against `main`), the last automated code pass before E2E and the user. This is where per-story review was consolidated to: reviewing the complete, coherent feature beats reviewing each story in isolation, and it costs one pass per epic instead of one agent per story.

Run it via the **`code-review-runner`** subagent — **not** inline. `/code-review --fix` pulls the entire epic diff into context and reasons over it; running it inline lands all of that in the orchestrator's session, where it is re-read on every subsequent turn for the rest of the epic (a large, avoidable share of orchestrator token cost). The runner does the review **inside a subagent** — its diff-reasoning is discarded with the subagent's transcript — applies its fixes to the shared working tree, writes its findings to a gitignored file, and returns only a path + status line. This mirrors how `playwright-runner` isolates the large E2E output. The runner inherits the orchestrator's model, so review quality is unchanged from running it inline. See [code-review-runner.md](../agents/code-review-runner.md).

```
Agent: code-review-runner
epicSlug: <slug>
effort: <medium | high>   # medium by default; high for a shared-surface epic or on request
```

A single pass reviews both **correctness bugs** and **reuse / simplification / efficiency cleanups** and applies its fixes to the working tree — there is no separate `/simplify` pass, because `/code-review` already covers everything `/simplify` would (it is a strict subset).

The runner returns only:

```
REVIEW_FILE: web/test-results/code-review-epic-<slug>.json
REVIEW_STATUS: <clean | fixes-applied | findings-remain>
```

`Read` the findings file for ground truth (never rely on the subagent to transcribe findings). Its `findings[]` carries `{ severity, category, file, line, summary, outcome }`; `outcome: "skipped"` entries are real findings `--fix` could not apply cleanly (`unresolved` counts them). On `REVIEW_STATUS: clean`, there was nothing to fix — skip straight to the commit below.

The runner patched the tree, but two judgments are still yours — the review sees the diff, not the running app or the backend's real contract:

1. **Guard the known limitations.** Inspect what the runner changed (`git diff` on the working tree) against `project.md` and the epic's `state.json.epic.unverifiedAssumptions`. **Revert** any "fix" that patches a deliberately-accepted constraint or invents backend behaviour the API doesn't support (e.g. persisting a session or lockout the backend has no timer for), and record it in the manual-test ledger (Step B7.1) instead — don't silently ship an over-reach.
2. **Re-verify green.** Re-run **Step B7.0** (full quality-check) — Vitest encodes each story's acceptance criteria, so it catches any correctness fix or refactor that broke a test, gate, or the build, and it rebuilds `web/.next` so the build B7.0.6 serves reflects these fixes. If a gate fails, attribute it to the owning story and route it through the developer fix cycle (`priorFailures.codeReview: <finding>`) exactly as Step B7.0 describes — that keeps the fix test-covered — then re-run this step. Any `outcome: "skipped"` finding (the runner reported `findings-remain`) is routed to the developer the same way.

Then **commit** any changes from this step on the epic branch:

```bash
git add web/src/ web/e2e/ generated-docs/epics/<slug>/
[ -f generated-docs/architecture.md ] && git add generated-docs/architecture.md
git commit -m "chore(<slug>): epic-end code review"
git push origin HEAD
```

(If nothing changed — no bugs found, no cleanups applied — skip the commit.)

Cap the review→fix loop at 3 delegated cycles; past that, fix it yourself. When the pass is clean, proceed to **Step B7.0.6** (epic-end Playwright) — the phase stays `EPIC-END` until E2E is green.

#### Step B7.0.6: Epic-end Playwright (production build)

**Browser-ready gate — before invoking `playwright-runner`.** The runner fails if Chromium isn't fully installed. `/start` pre-warms it in the background, but on a slow/proxied machine it may still be running here. Get it ready **once, without racing a second install:**

- **If the `/start` download is still running, wait for it** (the harness notifies on completion). Don't start a second install — it shares one lockfile, so the two block each other — and don't `ScheduleWakeup`-poll. Tell the user once: *"Finishing a one-time browser download before the tests — slow here, but it only happens once."*
- **Otherwise, run it once, blocking:** `(cd web && npm run test:e2e:install)`. Idempotent (no-op when the matching build is present), browser binary only so it never needs root. Judge it by its **exit code**: don't pipe through `tail`/`head` (they withhold all output until it exits, so a healthy install looks dead), and never kill-and-retry (a killed install leaves a stale lock → the "stuck at 100% every time" spiral).
- **Timing:** unpacking after 100% is bounded — give it ~5 min. Past ~10 min it's not unpacking but a stalled download (proxy) or a leftover lock; stop and point the user at the Troubleshooting "stuck at 100%" steps rather than waiting or retrying.
- **Linux:** if it installs but the browser won't *launch* (missing `libnss3.so` etc.), that's the one-time `sudo npx playwright install-deps chromium` in Troubleshooting — surface it, don't retry.

Only then invoke the runner.

Gates and code review are green and `web/.next` holds the production build from Step B7.0 — now run the epic's Playwright specs once against that build (see [playwright-runner.md § Your task](../agents/playwright-runner.md)). The runner sets `E2E_PROD=1`, so Playwright serves the prebuilt app with `next start` instead of the on-demand-compiling dev server — that removes the parallel-worker ChunkLoadError / slow-first-render flakiness that used to produce false failures:

```
Agent: playwright-runner
mode: epic-end
epicSlug: <slug>
```

The runner runs every `web/e2e/epic-<slug>-story-*.spec.ts` once, writes Playwright's JSON report to `web/test-results/e2e-epic-<slug>.json` (gitignored), and returns **only** that path and a `PLAYWRIGHT_EXIT` line. **Read the JSON file for ground truth via the summarizer — never rely on the agent to transcribe results** (it is instructed not to, and earlier runs hallucinated test titles and invented parse errors when they tried):

```bash
node .claude/scripts/summarize-playwright.js web/test-results/e2e-epic-<slug>.json
```

It prints the authoritative top-level `stats`, every failing spec **already mapped to its story** (via the `epic-<slug>-story-<N>-<title>.spec.ts` filename), and any **run-level errors** (globalSetup / server / config failures that aren't tied to a spec). It exits `0` for a clean run, `1` when a spec/test failed **or** a run-level error occurred, `2` when the report is missing/unparseable. The recursive `suites[].suites[].specs[]` walk lives in the script — don't re-implement it inline. Add `--json` for the same data as a machine object (`{ stats, failures[], errors[], result }`).

If the summarizer exits `2` (missing/unparseable report) **and** `PLAYWRIGHT_EXIT` was non-zero, treat it as a real run failure: re-invoke the runner once (it's idempotent). If it recurs, treat it as the run-level case below. Do not accept a prose diagnosis from the agent in place of the file.

**Run-level errors (no failing spec).** If the summarizer exits `1` but lists **only** run-level errors with no per-story failures (its `errors[]` is non-empty and `failures[]` is empty), the run failed before tests could attribute — e.g. the prod server (`next start`) never started or globalSetup threw. Do **not** enter the per-story fix loop (there's no story to fix). The environment is broken, not the app — the one failure you can't resolve. Tell the user the tests couldn't run at all, say what stopped them, and stop; re-running the same broken environment won't help. A `stats.unexpected: 0` here is **not** a pass — trust the non-zero exit.

**Per-story attribution + fix cycles.** For each failing spec (`ok: false`, i.e. counted in `stats.unexpected`):

1. Take the story number from the summarizer's `story` field for that failing spec (it parsed the `epic-<slug>-story-<N>-<title>.spec.ts` filename for you).
2. Re-invoke `developer` for story `N`, passing the failing spec's error (the summarizer's `error` field, or the raw entry in the JSON file) as `priorFailures.playwright`.
3. **Re-run Step B7.0 (full quality-check)** — it re-gates the developer's fix *and* rebuilds `web/.next`, so the re-run in the next step serves the corrected code rather than the stale build. (This is why an E2E fix loops back through the quality-check, not straight to a spec re-run.)
4. Re-invoke `playwright-runner` with `mode: epic-end-fix`, `storyFilter: <N>` to re-run just that story's spec against the fresh build — it writes `web/test-results/e2e-epic-<slug>-story-<N>.json`; read that file for the result.
5. Loop per story until it passes, or until 3 delegated cycles are spent — then fix that story yourself. A failing spec is never carried past — the story's code is already committed.

When every spec passes, update `state.json.stories[<N>].e2eStatus` to `"passed"` (first-try) or `"passed-after-fix"` (fix-cycled). Then transition `state.json.phase` from `EPIC-END` to `MANUAL-TEST`, regenerate the dashboard, and proceed to Step B7.1.

#### Step B7.1: Manual-Test Approval

**Open the check-off page (primary path).** Build the payload per the [Manual-Test Check-off Page](../shared/approval-pattern.md#manual-test-check-off-page-manual-test-approval) rules — the `unverifiedAssumptions` ledger, role logins, and the checks grouped to minimise persona-switching — then render and open it:

```bash
node .claude/scripts/render-manual-tests.js --in "generated-docs/epics/<slug>/review-payload.json" --out "generated-docs/epics/<slug>/manual-tests.html"
node .claude/scripts/open-page.js "generated-docs/epics/<slug>/manual-tests.html"
```

The page's **Done** button auto-copies `{ decision: "manual-test-results", epic, allPassed, summary, failed, todo, results }` for the user to paste back (or they type `all passed`). This resolves the **same** approval as the AUQ below. If the page can't be generated or opened, fall back to the in-chat checklist at the end of this step.

**Handling the pasted `{ decision: "manual-test-results", ... }`:** first **persist `results` to `state.json.epic.manualTestResults`** (via Edit) so a post-fix re-display can carry ticks forward. Then: `allPassed: true` (or `all passed`) → take the "All good" branch. Otherwise → take the "Found an issue" branch, feeding each `failed` item's `comment` + `story` into the [Fix-cycle integration](#fix-cycle-integration), then **re-render and re-open** the page after the fix (`open-page.js` only launches the file — regenerate it first, or the user sees the pre-fix page with none of their ticks).

Each item carries `kind`: `"assumption"` is a check-these-first ledger item (`story` is `null`) and takes the data-contract branch; `"story"` takes the per-story branch. Classify on `kind`, not by matching the text against `unverifiedAssumptions`.

**`todo` is not a failure.** Those are checks the user left unticked with nothing written against them — there's no reported behaviour to fix, so never route them to the fix cycle. When `failed` is empty and only `todo` remains, ask whether they want to finish those checks or move on (`AskUserQuestion`: *"Run the rest"* / *"Move on"*); "Move on" takes the "All good" branch and records the unchecked items in the journal. When both are non-empty, fix the failures first, then re-open the page with the `todo` items still unticked.

**Output text (before the AUQ):**

```
[Epic name] is built and ready for you to try. I've opened the test checklist in your
browser — tick off what works, and tell me anything that doesn't.
```

**Fallback — only when the render or the open fails.** Render the checklist in chat by these rules, in place of the two-line output above; the `AskUserQuestion` is unchanged.

- **Check-these-first ledger.** When `state.json.epic.unverifiedAssumptions` is non-empty, render it **first**, above the per-story checklist, under a `⚠️ Check these first` heading. These are the real-backend assumptions the automated tests couldn't verify (the mocks encode the same guess the code does — see [feature-planner § Unverified Assumptions](../agents/feature-planner.md#unverified-assumptions-the-manual-test-approval-ledger)), so they are the highest-value things for the user to confirm against the live backend. Omit the heading entirely when the array is empty.
- **Group by story.** Each story's items appear under a bold story title heading so the user knows what they're testing.
- **Skip infrastructure-only stories** (`isInfrastructureOnly: true` or empty `manualTestChecklist`). They have no user-testable behaviour.
- **Do not re-render non-goals.** They're a planning concern, not a test step.
- **Length budget.** Single AUQ even for long lists. If a future epic exceeds ~30 items, log a one-line warning (planning signal the epic should have been split) but still render.
- **Tick state persists across fix cycles.** On the **first** display everything starts unticked. When the user pastes back `manual-test-results`, store its `results` array in `state.json.epic.manualTestResults` (via Edit) — this is the ground truth of what passed. On any **re-display after a fix** (step 5 of the fix cycle), carry those ticks forward: pre-tick every test whose prior result was `passed: true`, and **uncheck only the tests the fix affected** — the reported failure(s), every test belonging to a story re-entered into BUILD/B2 this cycle, and (for a contract correction) the failed `unverifiedAssumptions` item plus tests of the stories consuming that contract. Leave all other previously-passed tests ticked so the user re-verifies only what changed, never the whole list. Tests with no prior result (newly added) start unticked.

**Fallback checklist text:**

```
Walk through these manual tests for [Epic name]:

[If state.json.epic.unverifiedAssumptions is non-empty:]
**⚠️ Check these first** — we couldn't verify these against the real backend automatically:
- ☐ [unverifiedAssumptions item 1]
- ☐ [unverifiedAssumptions item 2]

**[Story 2 title]**
- ☐ [test item 1]
- ☐ [test item 2]
...

**[Story 3 title]**
- ☐ [test item 1]
...
```

Then `AskUserQuestion`:

- **Question:** "Did everything check out?"
- **Options:**
  - "All good" — transition `state.json.phase` to `COMPLETE-ON-BRANCH`. Proceed to B7.2.
  - "Found an issue" — see [Fix-cycle integration](#fix-cycle-integration) below.
  - "Skip for now" — transition `state.json.phase` to `COMPLETE-ON-BRANCH` and record the skip in the journal. Proceed to B7.2.

##### Fix-cycle integration

When the user picks "Found an issue":

1. `AskUserQuestion` (free-text via "Other"): *"What's the issue? Paste or describe the test step that failed and what you saw instead."*
2. **Classify the report — check the `unverifiedAssumptions` ("check these first") items before the per-story `manualTestChecklist`.** When the report came from the check-off page, its `kind` already tells you which branch to take; only a free-text report needs matching:
   - **A failed `unverifiedAssumptions` item** is a *data-contract* failure, not a UI bug: the real backend shape differs from the brief's assumption, so the mocks, tests, and code all encode the same wrong guess ([mock-boundary blindness](../policies/testing-policy.md#mock-boundary-blindness)) — re-running the developer alone just satisfies still-wrong tests. Mirror the [undocumented-endpoint flow](#step-b3-developer): (a) ask a short follow-up for the **real** response shape/values; (b) correct the affected entity factory at `web/src/mocks/data/<entity>.ts` (or `identity.ts` for the userinfo contract) — one shared source, so both test layers pick up the fix. Correct the canonical spec (`generated-docs/specs/api-spec.yaml`) too when one exists; when the user's read-only spec under `documentation/` is the only one, record the mismatch in `generated-docs/architecture.md` under **Cross-epic debt** instead — the field or endpoint, what the spec says, what the backend does — so a later epic can't re-derive the wrong shape. Commit; (c) **re-run `test-generator`** (as in Step B0.2 — not the B2 confirm) for the story/stories whose `targetFile` consumes that contract, overwriting their now-outdated specs so tests reflect the corrected contract before the developer touches code. Package `priorFailures.contractCorrection: { assumption, realShape }`.
   - **A per-story `manualTestChecklist` item — clear match** → proceed with that story via B6.
   - **Ambiguous match** → follow-up AUQ; list candidate stories with an "Other / multiple stories" option, then B6.
3. Transition `state.json.phase` from `MANUAL-TEST` back to `BUILD` (the transition graph allows this re-entry).
4. For a checklist failure, re-enter Step B6 for the chosen story with the user's report packaged as `priorFailures.manualTest: { description: <free-text>, storySlug: <slug> }`. (A contract-correction failure does **not** re-enter here — it follows step 2(c): re-run `test-generator` to regenerate the specs against the corrected contract, then the developer. Not B6, and not the B2 confirm.)

   **4a. Is this a change of mind rather than a bug?** Only when `generated-docs/design/digest.md` exists. **The test:** *would rebuilding this screen from the digest undo what the user just asked for?*

   - **No — it's a bug.** A broken button, a wrong total, a crash. Fix it; record nothing.
   - **Yes — it's a decision.** "Move the filter to the right", "drop that column", "make this the default tab". Append it to the digest's **Your Decisions** section (append only; leave the rest of the digest alone) before re-entering B6, in the entry shape from [approval-pattern.md § Recording a decision that overrides the design](../shared/approval-pattern.md#recording-a-decision-that-overrides-the-design). B5's commit stages the digest automatically.
   - **Genuinely unclear → record it.** A redundant line costs nothing; a lost decision costs the user their change the next time the design is read.
5. After the developer + light gate (B4) pass, walk back through B7.0 (full quality-check), B7.0.5 (code review), and B7.0.6 (epic-end Playwright re-run), then re-display the B7.1 manual-test approval — re-rendering `manual-tests.html` with `priorPassed: true` on every check whose `state.json.epic.manualTestResults` entry passed, so those stay ticked and **only the affected tests** (the reported failure(s) + the re-entered story's tests, or the corrected contract's assumption + consuming stories) come back unchecked for re-verification.

**If three fix attempts on this epic have failed,** stop fixing and re-evaluate before you ask anything: what is still wrong, whether it's one problem or several, why the attempts missed it, and what putting it right would take. Then put it to the user with the options that genuinely fit what you found — described in terms of their app, never the workflow's.

#### Step B7.2: PR + Merge

**B7.2.1 — Commit the phase transition, then push the branch:**

The `EPIC-END → MANUAL-TEST → COMPLETE-ON-BRANCH` transitions (plus any manual-test journal notes) were written to `state.json` via `Edit` but are **not yet committed**. Commit them to the epic branch **now, before the PR.** If you skip this, the merge lands a stale phase on `main` — so `mark-epic-complete` (B7.2.6) sees `EPIC-END` instead of `COMPLETE-ON-BRANCH` — and the uncommitted edit blocks `gh`'s post-merge `git checkout`, which orphans the remote branch. Do this even when there's no remote (it keeps the local branch tip authoritative):

```bash
git add generated-docs/epics/<slug>/
# Transcript-collection id:
[ -f transcript-collection.json ] && git add transcript-collection.json
git commit -m "chore(<slug>): manual test passed — ready to merge"   # "manual test skipped" on the Skip path
```

(If `git add` staged nothing, the transition was already committed — skip the commit and continue.)

Then check the remote; if `git remote -v` is empty, the rest of B7.2 doesn't apply — emit *"<Epic name> is finished. This project has no remote, so merge it yourself when you're ready:"* followed by `git checkout main && git merge epic/<slug>` on its own line, and end /continue. Otherwise:

```bash
git push -u origin epic/<slug>
```

**B7.2.1b — Sync with `main` before the PR (§6.1 checkpoint):**

Another session may have landed a `project.md` or plan change on `main` during this run — this epic's on-entry §6.1 checkpoint ran only once, back at the start, so a long BUILD → EPIC-END → MANUAL-TEST run can reach here against a stale `main`. Before opening the PR, run the [§6.1 checkpoint](../policies/epic-branch-concurrency.md#61-project-level-changes): `git fetch origin`, and when `epic/<slug>` is behind `origin/main`, `git rebase origin/main` (conflicts per §6.2) then `git push --force-with-lease origin epic/<slug>`. If the advance carried a `project.md` fact this epic relied on, surface a one-line note and re-check the affected stories before continuing. Skip silently when there's no remote or the branch is already current. (This is proactive; the reactive rebase at B7.2.5 only fires if the *merge* is rejected, which the merge-commit strategy won't be for a merely-behind branch.)

**B7.2.2 — Open the PR:**

```bash
gh pr create --base main --head epic/<slug> \
  --title "feat(<slug>): <epic name>" \
  --body "<body>"
```

The `<body>` is generated from `state.json` + `journal.md`. Derive every story's short SHA in a single call — `git log main..HEAD --grep="feat(<slug>/story-" --format="%h %s"` — and map each line to its story via the `story-<N>` token in the subject:

```
## Epic summary
<epic.name> — <one-line goal from brief.md>

## Stories
- Story 1: <title> (<commit-sha-short>)
- Story 2: <title> (<commit-sha-short>)
- ...

## Manual test
Passed on <ISO date>.

## Notes
<Omit this section unless there's something for the *user*. Architecture handoffs and reusable-code facts now live in `generated-docs/architecture.md` (future epics read it) — do NOT repeat them here. If `generated-docs/template-feedback.md` gained entries this epic, add one line: "Logged N template-tooling issue(s) for the maintainers in `generated-docs/template-feedback.md` (notes, not blockers).">
```

If `epic.dependsOn` is non-empty in state.json, prepend a line: *"Depends on `epic/<slug-A>` PR (must merge first)."* — see [epic-branch-concurrency.md §6.3](../policies/epic-branch-concurrency.md#63-cross-epic-dependencies).

**B7.2.3 — Wait for CI:**

**Output to user:** `Running the automated checks on <Epic name> — this might take a few minutes.`

```bash
gh pr checks --watch
```

- **All checks pass** → proceed to B7.2.4.
- **GitHub can't run them** (none started within ~15 min, or a job failed without starting) → if B7.2.1b rebased, re-run Step B7.0 first; then proceed to B7.2.4.
- **A check fails** → read `gh run view <run-id> --log-failed`, fix it as in Step B7.0, then commit, push and re-watch. A one-off hiccup: `gh run rerun --failed <run-id>` once instead.

**B7.2.4 — User confirms merge:**

`AskUserQuestion`: *"Checks passed. Ready to merge <Epic name>?"* If GitHub couldn't run them, say so and that they passed on this computer; if their account is the cause (Actions off, out of minutes), say what to change.
- "Merge now" — proceed to B7.2.5.
- "Hold off — I'll merge later" — emit *"<Epic name> is ready and waiting. Merge it when you like:"* followed by `gh pr merge --merge` on its own line. End of /continue.

The merge *strategy* is fixed policy, not a per-epic question — the workflow always uses a merge commit (see B7.2.5). Only the merge *approval* is asked, because merging to main needs explicit confirmation.

**Orchestrator never auto-merges.** Per [CLAUDE.md "executing actions with care"](../../CLAUDE.md) merging to main is the kind of action that needs explicit user confirmation.

**B7.2.5 — Merge + cleanup:**

```bash
gh pr merge --merge --delete-branch     # always a merge commit — never squash (see rationale below)
```

**Why a merge commit, always:** an epic branch already carries clean, meaningful history — one conventional commit per story (`feat(<slug>/story-<N>)`), plus the plan and quality-fix commits — so there's no messy WIP to hide. A merge commit preserves that per-story granularity on main (so a later `git bisect` can land on the story that introduced a regression) while still giving a tidy one-line-per-epic view via `git log --first-parent main`. Squash would flatten every story into a single commit and throw that away for no real gain — reverting a whole epic is `git revert -m 1 <merge-sha>` either way. Do **not** reintroduce a squash option or ask the user to choose per epic. (This assumes the GitHub repo allows merge commits, which is the default; if a repo is locked to squash-only, `--merge` fails and the user must enable merge commits in repo settings.)

If this fails because the branch is behind main (another epic merged first, or a §6.1 project change landed), rebase per [epic-branch-concurrency.md §6.2](../policies/epic-branch-concurrency.md#62-shared-evolving-artifacts--pr-time-conflict-resolution): `git fetch origin && git rebase origin/main`, resolving conflicts per the §6.2 conflict-class table (Tier 1 auto-merge, Tier 4 halt). After rebase, `git push --force-with-lease origin epic/<slug>` and retry the merge.

If the repo requires checks GitHub couldn't run, never use `--admin`: say *"<Epic name> will merge once GitHub's checks are running again — run /continue then."* and end /continue.

`--delete-branch` removes the remote branch. Then locally:

```bash
git checkout main && git pull origin main
git branch -D epic/<slug>
```

Because B7.2.1 committed the phase transition, the working tree is clean at merge time, so `gh`'s `--delete-branch` and this `git checkout` both succeed. If the remote branch nonetheless lingers (e.g. `gh`'s cleanup was interrupted), delete it via the API — **never `git push origin --delete`, which the [`bash-permission-checker`](../hooks/bash-permission-checker.js) hook blocks as a destructive push:**

```bash
gh api --method DELETE "repos/{owner}/{repo}/git/refs/heads/epic/<slug>"
```

**B7.2.6 — Final state transition + `CLAUDE.md` check:**

First bring `CLAUDE.md`'s `## Project Overview` into line with `generated-docs/project.md`, per [project-overview.md](../shared/project-overview.md). If you corrected nothing, confirm you left the file alone:

```bash
# only when you corrected nothing — this discards a correction you did make
git diff --quiet -- CLAUDE.md || git checkout -- CLAUDE.md
```

The merged commit on main now contains `generated-docs/epics/<slug>/state.json` from the branch tip — that's the historical record. Flip its `phase` from `COMPLETE-ON-BRANCH` to `COMPLETE` and commit both on main:

```bash
node .claude/scripts/mark-epic-complete.js --slug <slug>
git add generated-docs/epics/<slug>/state.json CLAUDE.md
git commit -m "chore(<slug>): mark epic complete"
git push origin main
```

(The dedicated CLI exists because Edit's file tracking does not survive branch switches reliably — a direct Node mutation keeps the post-checkout write deterministic.)

**B7.2.7 — Summary to user:**

```
<Epic name> is done and merged.
Build the next epic with /start, or plan one ahead with /plan.
```

End of /continue.

---

## Adding the next epic

The epic-branch workflow ends at Step B7.2.7. To work on another epic, run **`/start`** to build the next one — it detects the existing `project.md`, then picks up a parked epic or sets up and builds a draft/new one — or **`/plan`** to plan the next epic ahead and park it at `READY-TO-BUILD` without building (e.g. in a parallel session while another epic builds). There is no "reopen the feature" path and no project-wide state to mutate — each epic is its own branch.

---

## Halt Handling

**Never halt for a failure in the workflow's own machinery** — a gate that won't go green, a test file that didn't get written. Resolve it and carry on, without narrating it. Critical Rule 5 still forbids calling a failing gate acceptable, and only a broken environment is genuinely beyond you (Step B7.0.6's run-level errors). If the cause was the workflow's own tooling rather than the app, log it per [agent-autonomy.md § template-feedback](../shared/agent-autonomy.md#generated-docstemplate-feedbackmd--maintainer-channel).

**Halt persistence:** mark the current story's `status: "halted"` in the epic's `state.json` so `/continue` after a session break re-surfaces the halt rather than blindly re-running BUILD.

---

## Dashboard Updates

Per the [Dashboard Update Policy](../shared/orchestrator-rules.md#dashboard-update-policy), the rule is: **after any write to `state.json`, regenerate the dashboard.** `/continue` entry (Step 1, on resolve), story start (B1), and story commit (B5) already fire it inline. The remaining state writes you own — fire it there too:

- INTAKE approval (project.md / epic brief committed)
- Stories approval (stories committed → BUILD)
- BUILD → EPIC-END, EPIC-END → MANUAL-TEST (and any re-entry to BUILD)
- After the manual-test approval resolves
- PR merge (epic marked COMPLETE on main)

```bash
node .claude/scripts/generate-dashboard-html.js
```

Fire-and-forget. On script failure, log a one-line warning and continue. (The `developer` agent also regenerates at the end of its turn — see the policy's deliberate-redundancy note.)

---

## Notes

- **State authority** — the epic's `generated-docs/epics/<slug>/state.json` (on the `epic/<slug>` branch, resolved via `resolve-state-path.js`) is the source of truth. `/continue` re-enters at whatever phase it shows. Resumption after a session break uses the same paths as initial execution.
- **Halts surface immediately** — no race conditions because BUILD is synchronous from the orchestrator's perspective
- **Tool budget & context budget** — keep parent tool calls per response at ~3 outside of natural turn boundaries (`AskUserQuestion` answers reset the budget). Delegate heavy, high-output work to subagents so its transcript never lands in — and is never re-read from — the orchestrator's context: `playwright-runner` isolates the E2E JSON (B7.0.6) and `code-review-runner` isolates the `/code-review --fix` diff-reasoning (B7.0.5). Both return only a file path + status line.
- **Brief is authoritative** — developer and test-generator agent files already encode "brief overrides template code." No per-call reminder needed from the orchestrator.
