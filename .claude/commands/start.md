---
description: Start building an epic — a new project runs INTAKE then builds the first epic; an existing one builds the next (a parked epic, or a draft/new one planned inline). To plan ahead without building, use /plan.
---

Start a new feature workflow. This command runs INTAKE only; PLAN and BUILD are handled by `/continue`, which is invoked automatically after the INTAKE approval.

```!
cat "${CLAUDE_PROJECT_DIR}/.claude/shared/orchestrator-rules.md"
```

## Dispatch

After Step 0 (setup), check for `generated-docs/project.md`:

- **Exists → Build the next epic:** see [Build the next epic](#build-the-next-epic-projectmd-exists) below — `/start` is the build entry point. Build an already-planned (`READY-TO-BUILD`) epic, or set up and build a draft/new epic (planning its stories inline, then building through). To plan the next epic *ahead* without building it — e.g. in a second session while this one builds — use [`/plan`](plan.md) instead.

- **Does not exist, legacy `generated-docs/context/workflow-state.json` present → route to `/migrate-legacy`.** The migration tool converts legacy artifacts to the epic-branch layout. After migration runs, /start re-dispatches and lands in the build-the-next-epic path.

- **Neither exists → Case A (first-time project setup):** full INTAKE (steps below). The intake-agent produces `project.md`; `feature-planner` then **decomposes** the spec into all epics; after the epic-plan approval, `project.md` + `epic-plan.md` + one `brief.md` per epic are committed to main, and the first ready epic is planned and built on its `epic/<slug>` branch.

The handoff to `/continue` is automatic in all cases.

## Flow (Case A — first-time project setup)

```
/start → [setup check] → [welcome + onboarding routing]
       → [scan-doc.js ∥ api-connectivity-agent spec analysis ∥ design-interpreter (when documentation/ has files)]   (parallel)
       → [3-question checklist: auth, backend, roles]
       → [api-connectivity-agent smoke test]   (skipped when dataSource ∈ {mock-only, new-api})
       → [intake-agent produce mode → project.md]   (reads the digest if the interpreter wrote one)
       → [feature-planner decompose → epic plan (epics + deps + coverage + blockers)]
       → ── INTAKE approval (two-step): resolve blockers → approve project setup + epic plan ──
            (plan revisions → feature-planner decompose; project.md revisions → intake-agent revise)
       → [commit project.md + epic-plan.md + all epic briefs to main]
       → [create the first ready epic's branch, initialise state.json]
       → [invoke /continue inline]
```

Every epic except the first lands on main as a **draft** (a `brief.md` with no `state.json`) — `/plan` (to plan it ahead) or `/start` (to build it) picks them up later.

---

## Step 0: Setup Check

Probe state with two Bash calls — **issue both in the same assistant response** so they run in parallel:

```bash
test -d web/node_modules && echo "installed" || echo "missing"
test -f .claude/preferences.json && echo "configured" || echo "missing"
```

**Both present →** "Project setup is complete." Set `backgroundInstallTaskId = null`, `verificationPending = false`. Go to Step 1.

**Otherwise, run the missing pieces concurrently** — issue the install Bash call and the `AskUserQuestion` in the **same assistant response** so the install overlaps the user's git-prefs answer:

- **`needsInstall` →** `(cd web && npm install)` with `run_in_background: true`. Capture the task ID as `backgroundInstallTaskId`; set `verificationPending = true` (Step 8.5 blocks on it before commit).
- **`needsPreferences` →** ask via `AskUserQuestion`: "How should Claude handle git commits and pushes?" Options: *Auto-approve both (recommended) / commits only / pushes only / Always ask*. Whatever isn't auto-approved, the workflow asks before each time per [orchestrator-rules.md §Git Commit & Push Authorization](../shared/orchestrator-rules.md#git-commit--push-authorization). Map → `node .claude/scripts/init-preferences.js --autoApproveCommit <true|false> --autoApprovePush <true|false>`. Don't use Write to create files in `.claude/` (prompts); the node script is auto-approved.

Post a one-liner ("Setup primed — dependencies installing in the background.") and continue to Step 1.

> **If Node.js isn't installed** — the background `npm install` fails with "node/npm is not recognized", or the user reports a repeating Windows "Select an app to open 'node'" popup — the fix is: install the LTS version from [nodejs.org](https://nodejs.org), **fully close and reopen VS Code** so it picks up the new PATH, then re-run `/start`. Don't work around it with a `node`/`npm` shim or stand-in file; it doesn't fix the PATH.

---

## Step 1: Confirm First-Time Entry

`/start` is the **first-time-only** entry point for a project. Dispatch has already determined this is Case A (no `generated-docs/project.md` on main). One safety guard:

- **Already on an `epic/*` branch?** (`git symbolic-ref --short HEAD` starts with `epic/`) → an epic is already in flight; this isn't a fresh start. Redirect and stop: *"An epic is already in progress. Run `/continue` to pick it up — or, to start something else, run this first:"* followed by `git checkout main` on its own line.
- **Otherwise** → proceed. There is no state file to initialise here: per-epic `state.json` is created on the epic branch at Step 9 (after the INTAKE approval), and resuming an interrupted intake is `/continue`'s job while planning or building a further epic is handled by `/plan` and `/start`'s build-the-next-epic path — not a third `/start` path.

## Step 2: Open Dashboard (Fire-and-Forget)

```bash
node .claude/scripts/generate-dashboard-html.js --collect
node .claude/scripts/open-page.js "generated-docs/dashboard.html"
```

On script failure, output `"Dashboard generation failed — you can run /dashboard manually later."` and continue.

## Step 3: Welcome + Onboarding Routing

Pre-scan `documentation/` so the welcome message reflects what's there:

```bash
node .claude/scripts/scan-doc.js documentation/ --keywords auth,role,session,compliance,mock,api
```

Parse the JSON output. Welcome line greets **generically from the file inventory** — never from a design-format signature (there is no format detection anywhere; whether the files contain a design is the `design-interpreter`'s content judgment, surfaced later at the INTAKE approval):

Branch on `summary.userProvidedFiles`, which already excludes the folder's own `README.md` (the template's explainer, present in every fresh clone) — so there's no inventory of your own to keep:

- **`userProvidedFiles > 0`:** "I see you have [N files] in `documentation/` including [2–3 key items]. We'll work with whatever's there."
- **`userProvidedFiles == 0`:** "I don't see anything in `documentation/` yet — that's fine, we have several ways to get started."

Then ask the routing question via `AskUserQuestion`:

- **Question:** "How would you like to get started?"
- **Options:**
  - **"Share what I have"** — "Put whatever you've got into `documentation/` — a spec, requirements, wireframes, API docs, or a design export (e.g. from Claude Design) — just drop the files in. Anything goes; I'll read it and confirm what I found."
  - **"Let's build requirements together"** — "I'll ask questions and we'll define the requirements from scratch."

**Pre-tick "Share what I have" either way** — whether or not anything is in `documentation/` yet, and whatever format it's in (we don't distinguish).

> **Why two options, not three.** A design export is just one kind of material you drop into `documentation/`; there's no separate import step and no importer. Whether what you shared contains a design is decided by *reading it* (the `design-interpreter`), not by its filename or format — so "Claude Design export" is example wording under "Share what I have," not its own lane.

### Option A: Share existing materials (`onboardingPath = "docs"`)

This is the single "share materials" lane — it covers specs, requirements, wireframes, API docs, **and** design exports (e.g. from Claude Design, dropped into `documentation/`). There is no importer and no separate design path: the user drops files in, and the `design-interpreter` (Step 4) reads whatever is there.

**Skip-rule (avoid redundant "ready?" prompt):**

If the Step 3 scan already showed `userProvidedFiles > 0`, the user has implicitly confirmed by picking this option. Do NOT ask the follow-up question. Instead, post a single one-liner acknowledgement and proceed directly to Step 4:

> "Working with the files in `documentation/`."

Proceed to Step 4 with `projectDescription = null`.

**Otherwise** (`userProvidedFiles == 0` — they intend to drop files in now):

> "Drop whatever you have into `documentation/` — feature specs, requirements docs, API schemas, wireframes, meeting notes, or a design export (e.g. from Claude Design). Anything goes. I'll work with whatever's there."

Then via `AskUserQuestion`:
- **Question:** "Let me know when your files are in place."
- **Options:** "Ready, I've added my files" / "Actually, let's do guided Q&A instead"

If "Ready": proceed to Step 4 with `projectDescription = null`.
If "Q&A": switch to Option B.

### Option B: Guided Q&A (`onboardingPath = "qa"`)

Ask as plain text:

> "What are you building? Give me the elevator pitch — who's it for, what does it do, and what's the core problem it solves. As much or as little detail as you like."

Capture the response as `projectDescription`. Proceed to Step 4.

---

## Step 4: Pre-Intake Parallel — Spec Analysis + Design Interpretation

The deep documentation scan ran in Step 3 (`scan-doc.js`); its JSON output already populates the welcome message and pre-ticks the checklist. Two agents run here — fire them **in parallel** (same assistant response) so their results are ready by the time the checklist completes:

- **`api-connectivity-agent`** Call A — spec analysis; writes the smoke-test plan (or an empty plan when no spec exists) to `generated-docs/specs/connectivity-plan.md` and returns status lines pointing at it.
- **`design-interpreter`** — **only when `documentation/` contains files** (i.e. Option A / `onboardingPath = "docs"`, or any path where the user dropped files; skip on the empty-`documentation/` guided-Q&A path). It reads whatever is in `documentation/` — any shape, any dialect — and, if it comprehends a design, writes `generated-docs/design/digest.md` and returns only `DIGEST_FILE` / `VERDICT` / `COUNTS` / `NEXT` — **`Read` the digest** for the screens, palette and Uncertainties you need at the approval. This is the single point of format-contact: nothing else reads the raw design files. Its `not-a-design` verdict (e.g. a pure BRD, or an opaque bundle it couldn't decode) is a normal outcome — no digest is written and intake proceeds without a design. **Pass `timestamp: <ISO 8601 now>` in the invocation** so it can fill the digest's `Last updated` row without inventing a date (the agent won't guess one).

Hold the Step 3 scan JSON in working memory and **read each agent's handoff file** — always the path its return names (`DIGEST_FILE`, `PLAN_FILE`), never a path you assumed, so you can't read a stale file from an earlier run. Neither agent returns its findings inline. You pass the scan to `intake-agent` produce mode (Step 7) as `scanResult`, and you surface the design verdict + Uncertainties (from the digest) at the INTAKE approval (Step 8). Call A's `GAPS` count tells you whether there are gap questions to ask; the questions themselves are in the plan file. The agents do not run in scan-preview mode — produce mode receives the orchestrator's scan and synthesises everything in one call, reading the digest the interpreter wrote.

---

## Step 5: Checklist — 3 Questions

Ask three questions via batched `AskUserQuestion` calls. Inferred answers from Step 4's scan pre-tick options where applicable.

### Q1 — Roles Template

- **Question:** "Which roles template fits your app?"
- **Options** (per [roles-snippets.md](../shared/roles-snippets.md)):
  - "SaaS Standard" — Owner / Admin / Member / Viewer
  - "Internal Tool" — Admin / User
  - "Marketplace" — Buyer / Seller / Moderator
  - "Editorial" — Editor / Author / Contributor / Reader

The auto-`"Other"` affordance handles `custom`. Pre-tick the inferred template if the scan returned one.

Silent accept on the four explicit templates: post a one-line acknowledgement ("Captured: [roles list]. You can refine in the brief at the INTAKE approval.") and continue. No drilldown.

### Q2 — Authentication Method

Always asked explicitly per [authentication-intake.md](../policies/authentication-intake.md) — **never inferred**.

- **Question:** "How will users authenticate?"
- **Options:**
  - "Server-side authentication" — "Backend handles OIDC login/logout, sets cookies. Frontend calls backend for user info."
  - "Frontend-only (next-auth)" — "Next.js handles auth directly using next-auth. **Note:** API calls won't carry session context — protects frontend routes only."
  - "Custom" — "I have a different authentication/authorization approach."

**Conditional follow-ups (fire after Q2 returns):**
- **Server-side:** plain-text prompts for login URL, userinfo URL, logout URL. Display backend-requirements + CI-implication note per [authentication-intake.md](../policies/authentication-intake.md) Rule 4.
- **Frontend-only:** display the trade-off warning per [authentication-intake.md](../policies/authentication-intake.md) Rule 5.
- **Custom:** plain-text prompt — "Describe your auth/authorization approach."

### Q3 — Backend Readiness

- **Question:** "Is your backend API up and running?"
- **Options:**
  - "Yes, it's running" — `dataSource: existing-api`
  - "No, still in development" — `dataSource: api-in-development`, mock layer required
  - "N/A — no backend API" — `dataSource: mock-only`

Combined with the scan's `hasApiSpec`, derive `dataSource` per the table in the existing decision matrix (collapsed):

| Spec exists | Backend status | dataSource |
|---|---|---|
| Yes | Running | `existing-api` |
| Yes | In dev | `api-in-development` |
| Yes | N/A | `mock-only` |
| No | Running | `new-api` |
| No | In dev | `api-in-development` |
| No | N/A | `mock-only` |

---

## Step 6: Smoke Test (skipped when dataSource is `mock-only`, or `new-api` without server-side auth endpoints)

Gate on the resolved `dataSource`: run `api-connectivity-agent` Call B when `dataSource` is `existing-api` (backend running); when `api-in-development`, run Call A only and defer (Shape 3 — backend not up yet); skip for `mock-only`. For `new-api` (backend running, no spec): skip **unless** server-side auth endpoints were captured (§Authentication) — then run a **reachability-only** Call B against the auth `userinfo` URL, since a running backend with a known endpoint can be probed even without a spec. Auth method otherwise doesn't change the gate. Procedure per [api-connectivity-agent.md](../agents/api-connectivity-agent.md): up to 3 attempts (Call B + 2 × Call C), curl-fallback, Shape 1/2/3.

For cookie-session auth, this verifies reachability only — never ask the user for login credentials (see [authentication-intake.md](../policies/authentication-intake.md) § Backend API Auth Rule 10 for the allowed credential-handling options).

The agent writes `backendConnectivity` (Shape 1/2/3, including the `reachabilityOnly` flag) to a result file and returns status lines — `RESULT` / `CATEGORY` / `SHOULD_RETRY` / `SHAPE` / `FLAGS` — so **`Read` the path its `RESULT_FILE` names** for the per-service detail you pass on. `SHOULD_RETRY: true` drives the Call C loop; `FLAGS: redacted=true` triggers the rotation warning. It does not write project.md itself; `intake-agent` records it at Step 7 during INTAKE. (A later backend re-check persists via the [§6.1 project-change flow](../policies/epic-branch-concurrency.md#61-project-level-changes); `/api-status` and `/api-go-live` write these rows on re-verification.)

Skip with a one-liner ("Backend connectivity check skipped (dataSource=[value]).") when not applicable.

---

## Step 7: Produce project.md (intake-agent)

Launch `intake-agent` in `produce` mode — it writes **`project.md` only** (no epic, no brief; the epics come from decomposition in Step 7.5):

```
mode: produce
onboardingPath: <docs | qa>
projectDescription: <text or null>
checklist:
  authMethod: <server-side | frontend-only | custom>
  authEndpoints: <object or null>
  customAuthNotes: <text or null>
  dataSource: <existing-api | new-api | api-in-development | mock-only>
  backendStatus: <running | in-development | none>
  rolesTemplate: <saas-standard | internal-tool | marketplace | editorial | custom>
  customRoles: <array or null>
backendConnectivity: <Shape 1/2/3 or null — carry the agent's `reachabilityOnly` flag so the `Smoke-test mode` row can be set>
```

The agent reads `documentation/` and the design digest (`generated-docs/design/digest.md`, when the interpreter wrote one — it never opens the raw design files), writes `generated-docs/project.md`, and returns only `PROJECT_FILE` / `COUNTS`. **`Read` the path it names** — that file is the project-level content for the INTAKE approval.

There is no "derive the first epic" step — the epics come from decomposition next, and the first epic to build is just the first *ready* one in the approved plan.

## Step 7.5: Decompose the spec into an epic plan (feature-planner)

Launch `feature-planner` in `decompose` mode:

```
Agent: feature-planner
mode: decompose
project: generated-docs/project.md
scanResult: <the Step 3 scan-doc.js JSON, passed verbatim>
proposalPath: generated-docs/epic-plan-proposal.md
```

The agent reads `project.md` + the spec (and the design digest's screen inventory when one exists) and **writes** the `DECOMPOSITION PROPOSAL` to `proposalPath`: `requirementInventory` (each requirement with the epic it's assigned to), `epics` (goal + `requirementIds` + `dependsOn`), `coverage` (`total` / `assigned` / `unassigned`), and `blockers` (plain-language; empty in the happy path). It returns only `PROPOSAL_FILE` / `MODE` / `STATUS` / `COUNTS`.

**`Read` the path its `PROPOSAL_FILE` names** — that's your copy of the plan for Steps 8a, 8b and 9. `STATUS: blockers` means go to 8a; `STATUS: ok` means skip to 8b. On each revision the agent overwrites the same file, so re-read it after every re-invoke, and don't paste the proposal back into the agent's prompt — it reads its own file. The file is regenerable and gitignored; nothing commits it.

---

## Step 8: INTAKE approval — Project setup + epic plan (two-step)

The INTAKE approval covers **`project.md` + the epic plan**. Per-epic briefs are written *after* approval (Step 9), so resolving a blocker never rewrites a brief. Two steps: clear blockers, then approve.

### Step 8a — Resolve blockers first

If the `DECOMPOSITION PROPOSAL`'s `blockers` is empty, skip to 8b.

Otherwise surface each blocker **before** the plan can be approved — one at a time, in the agent's plain language (it already applied the Translation Rule; render the three labelled lines verbatim). The `⚠` lead-in is your own one-sentence summary of `blocker.theSnag` — there is no separate headline field on the blocker. For each blocker, output the four-line block as regular text:

```
⚠ [your one-line summary of theSnag — the decision the user must make]

What you asked for: [blocker.whatYouAskedFor]
The snag:           [blocker.theSnag]
What I'd suggest:   [blocker.whatISuggest]
```

Then `AskUserQuestion`:
- **Question:** the recommended fix, phrased as a question
- **Options:** `blocker.options` (recommended first) — the auto-`"Other"` affordance covers "something else"

Re-invoke `feature-planner` `decompose` with `revisionFeedback` describing the user's choice; it rewrites the proposal file (re-assigned requirements, a merged/added epic, or a dropped requirement) with `coverage` re-verified — re-read it, and check `STATUS` again. Repeat until `blockers` is empty. **Never let the user approve a plan with an open blocker.**

### Step 8b — Approve project setup + epic plan

Follow the [Approval Pattern](../shared/approval-pattern.md). Output as regular text *before* the `AskUserQuestion` — project facts from `project.md`, the plan from the (now blocker-free) proposal file:

```
Here's the project setup and the plan I've put together.

**Project setup:**
- Roles: [roles]
- Auth: [auth in plain words]
- Data source: [where the data comes from]
- Compliance: [compliance, or "None"]

**The plan — [N] epics:**

1. **[Epic name]**
   [if dependsOn non-empty:] *Builds on: [dependency epic names]*
2. **[Epic name]**
   ...

Everything you asked for is covered[, except the [N] you chose to drop].

[If the interpreter returned `not-a-design` **and its NEXT line asks for the design in a readable form** (an opaque bundle it couldn't decode — *not* the "no design was shared" case, which needs no message): surface that NEXT line — e.g. "The design file you shared is an opaque bundle I couldn't read your screens out of — share it in a readable form (the individual/unpacked files rather than a single self-contained bundle) and I'll pick it up."]

[If the design-interpreter read a design:]
From your design I picked up [N] screens: [names].
[If it left Uncertainties:]
**A few things I couldn't pin down from the design — I'll confirm these with you as we plan each screen:**
- [each Uncertainty, in its own words]

[If `inferred` is non-zero — read project.md's `[INFERRED]` markers and put them in your own words:
**Worth a careful look:**
- [item]
]

I've opened the full plan in your browser. Change anything you like there, then click
Approve — it copies your version for you to paste back here. If it's good as it stands,
just answer below.
```

The interpreter's confidence rating is not shown at all.

**Open the editable review page.** Build the payload from the (blocker-free) proposal file per the [Editable HTML Review Page](../shared/approval-pattern.md#editable-html-review-page-plan-approvals) rules, then render and open it:

```bash
node .claude/scripts/render-epic-plan-review.js --in "generated-docs/review-payload.json" --out "generated-docs/epic-plan-review.html"
node .claude/scripts/open-page.js "generated-docs/epic-plan-review.html"
```

The page renders the epic list with editable names/goals/dependencies (add / remove / reorder), and resolves the **same** approval as the AUQ below. The user can click **Approve** on the page — it auto-copies `{ decision: "epic-plan", edited, epics: [{ name, goal, dependsOn }] }` for them to paste back — or answer in chat. On script failure, output a one-liner and fall back to the in-chat approval.

Then `AskUserQuestion`:
- **Question:** "Ready to lock in this plan and start building the first epic?"
- **Options:**
  - "Approve" — write the plan + briefs, start the first ready epic
  - "Adjust the plan" — change epics / dependencies / which epic owns what (free-text)
  - "Adjust project setup" — roles / auth / backend / compliance / styling (free-text)
  - "Start over" — interpretation is off; clarify path/approach and re-run intake

**Routing revisions:**
- *Pasted `{ decision: "epic-plan", ... }` from the page* → if `edited: false` (or the user typed `approved`), treat as *Approve*. If `edited: true`, the `epics` array is the user's revised plan — re-invoke `feature-planner` `decompose` with the edited epics/goals/dependencies as `revisionFeedback` so coverage is re-verified, then proceed to Step 9 (re-run 8a first if the edit reopened a blocker). Never write the plan straight from the pasted JSON without the coverage re-check. Each entry carries its original `slug` (`null` for an epic the user added) so you can tell a rename from a new epic, and `dependsOn` holds epic **names** as the page showed them, not slugs.
- *Adjust the plan* → re-invoke `feature-planner` `decompose` with `revisionFeedback`; re-display 8b (re-run 8a first if the change introduces a blocker).
- *Adjust project setup* → re-invoke `intake-agent` `mode: revise` (target: project.md). **If the user's answer also settles an open design Uncertainty** (typically a palette or typography gap the interpreter couldn't find in the files), append it to the digest's **Your Decisions** section per [approval-pattern.md § Recording a decision that overrides the design](../shared/approval-pattern.md#recording-a-decision-that-overrides-the-design), so it isn't re-asked the next time the design is read. If a critical field changed (roles / auth / data-source / compliance), re-run `decompose` so the plan reflects it — and **if that re-run surfaces a blocker, go back through 8a before re-displaying 8b** (a compliance change in particular can introduce a regulatory blocker). The "never approve with an open blocker" rule holds on this path too.
- *Start over* → ask plain text — "What should we change about the path or approach? (e.g., 'switch to guided Q&A', 'roles template is wrong', 'my docs were incomplete')" — then re-run from the relevant step.

Loop until approved.

---

## Step 8.5: Background-Work Check

Only run if `verificationPending == true` (set at Step 0). Otherwise skip.

1. **Wait for `npm install`.** If `backgroundInstallTaskId` is still active, wait for it. Non-zero exit → STOP, surface error, do not commit. **On success, pre-warm the E2E browser:** kick off `(cd web && npm run test:e2e:install)` with `run_in_background: true` — don't wait for it or gate the commit on its exit. It downloads Chromium (~130 MB) during PLAN/BUILD so it's usually ready by the epic-end E2E run instead of stalling there (node_modules exists now, so the pinned Playwright CLI is available). Browser binary only (not `--with-deps`), so it never needs root or a `sudo` prompt. If it's slow or fails, no harm here — the epic-end browser-ready gate ([continue.md](continue.md) § Step B7.0.6) reconciles it.
2. **Run verification in parallel.** Issue all three commands as **separate Bash tool calls in a single response**, each with `run_in_background: true`. Do NOT chain them with `&&` and do NOT call them sequentially across responses — that's the difference between a ~15 s gate and a ~45 s one.
   ```bash
   (cd web && npm run typecheck)
   (cd web && npm run lint)
   (cd web && npm run build)
   ```
   Wait for all three to finish. Any non-zero exit → STOP and surface the failure. All pass → set `verificationPending = false` and continue.

---

## Step 9: On Approval — write the plan to main, start the first epic

The whole plan lands on **main** as drafts; the first ready epic then starts on its branch.

**1. Write each epic's `brief.md`.** Loop `intake-agent` `epic-only` once per epic in the approved plan (decomposition-driven). These are independent files — run them as a parallel Task batch:

```
Agent: intake-agent   (one call per epic)
mode: epic-only
epicSlug: <slug>
epicName: <name>
epicGoal: <goal>
assignedRequirements: <[{ name, text }] — this epic's slice of requirementInventory>
```

Each writes `generated-docs/epics/<slug>/brief.md`.

**2. Confirm every brief came back.** One `BRIEF_FILE` return per epic, matched by slug, not by counting — a notification can be dropped mid-turn, so a missing return doesn't mean a missing brief, and a directory listing isn't verification. Re-invoke any epic you have no return for; `epic-only` overwrites, so it's safe.

**3. Write `generated-docs/epic-plan.md`** from the approved proposal — see [§ epic-plan.md format](#epic-planmd-format) below.

**4. Write `CLAUDE.md`'s `## Project Overview`** per [project-overview.md](../shared/project-overview.md).

**5. Commit project.md + the plan + all briefs to main:**

```bash
git add generated-docs/ documentation/ CLAUDE.md
[ -f transcript-collection.json ] && git add transcript-collection.json
# Stage the directory, not individual paths under it: design/ and specs/ exist only sometimes, and `git add`
# fails (exit 128, nothing staged) on a pathspec that matches no file. Review pages, agent
# proposal handoffs and the dashboard under generated-docs/ are gitignored, so this stages
# only the intake bundle.
git commit -m "docs(project): project setup + epic plan"
git push origin HEAD   # best-effort; skip silently if no remote
```

Every epic is now a **draft** on main (`brief.md`, no `state.json`). Independent drafts can be planned (`/plan`) or built (`/start`) in parallel from other sessions.

**6. Start the first ready epic.** Pick the first epic whose `dependsOn` is empty (a dependency root — nothing is merged yet, so only deps-free epics are ready). Then create the chosen epic's branch and initialise state:

```bash
git checkout -b epic/<firstSlug>
node .claude/scripts/epic-state.js --init --name "<firstName>"   # root epic → no --depends-on
git add generated-docs/epics/<firstSlug>/
git commit -m "docs(<firstSlug>): start epic"
git push -u origin epic/<firstSlug>   # best-effort; skip silently if no remote
```

`epic-state.js --init` resolves the path from the current `epic/*` branch and writes `state.json` at `phase: PLAN`. Verify `"status": "initialised"`; on error (e.g. `state.json already exists`), STOP and report. There is no separate phase-transition step — `state.json` starts at `PLAN` by construction.

### epic-plan.md format

`generated-docs/epic-plan.md` is the human-readable plan + dependency graph + coverage map. It holds **plan data only** — live status (not-started / in-flight / done) is derived from git by `/status` and the dashboard, never written here. It is edited **only in a planning context on main** (Step 9, or `/plan` / `/start` adding a new epic) — never on an epic branch (keeps it conflict-free across concurrent epics; see [epic-branch-concurrency.md §6.2](../policies/epic-branch-concurrency.md#62-shared-evolving-artifacts--pr-time-conflict-resolution)). v1 shape (settle refinements against the first real run):

```markdown
# Epic Plan — <Project Name>

Every epic in this project, what it delivers, and what it builds on. Live status
(not started / in flight / done) is shown by `/status` and the dashboard.

> Plan only — edited during planning on `main`, never on an epic branch.

## Epics

| # | Epic | Delivers | Builds on |
|---|---|---|---|
| 1 | <Name> (`<slug>`) | <one-line goal> | — |
| 2 | <Name> (`<slug>`) | <one-line goal> | <Name> (`<slug-1>`) |
| … |

## Coverage

Everything in the spec is assigned to an epic:

| What you asked for | Epic |
|---|---|
| <readable name> (R1) | <Name> (`<slug>`) |
| <readable name> (R2) | <Name> (`<slug>`) |
| … |

_<N> requirements, all assigned._
```

---

## Step 10: Hand Off to /continue

Tell the user (conversationally, one line):

> "Plan approved. Starting on <first epic name>."

Then invoke `/continue` via the Skill tool. The handoff is seamless — no user prompt.

`/continue` resolves state via `resolve-state-path.js` from the current `epic/<firstSlug>` branch, sees phase `PLAN`, and drives the stories approval. See [continue.md](./continue.md) for the rest of the flow.

---

## Build the next epic (project.md exists)

`project.md` is on main; `/start` here **builds** the next epic. It never parks — planning happens inline when needed, then BUILD runs through. (To plan an epic *ahead* and park it without building — e.g. in a parallel session while this one builds — use [`/plan`](plan.md).) Run it from `main` or the epic's own workspace; it reuses Step 0 (setup check).

### Step B1: Pick what to build

Read readiness and show the recap per the [shared epic picker](../shared/epic-picker.md) (it owns the data call, the `✓ ▸ ◆ ● ⊘` legend, the `hasPlan: false` fallback, and the up-to-3/ready-first convention). Then `AskUserQuestion` — *"What would you like to build next?"* — with these build-verb options:

- **Already-planned epics** (`status: ready-to-build`) — offer each as *"Build <name> (already planned)"*. These were parked by `/plan`; building one needs no re-planning.
- **Drafts** — offer each as *"Plan & build <name>"* (ordered/labelled per the shared picker).
- **"Set up something new"** — this also covers a **design update**: the user changes their design files in `documentation/` and describes an epic to rebuild against them ("rebuild the dashboard and settings screens to match my updated design"). There is no separate refresh lane — a design update is a normal epic (see [Step B2](#step-b2-cut-the-epic-branch-fresh-from-main)), and it can equally be planned ahead with [`/plan`](plan.md#step-3b-read-the-changed-design-design-update-epic-only) and picked up here later.

### Step B2: Cut the epic branch fresh from `main`

Every build branch is cut from the **latest `main`**, whichever kind of epic this is — so a
`ready-to-build` plan parked by [`/plan`](plan.md) (which lives on `main`, not a side branch) comes along
with it and is never stale.

- **Already-planned (`ready-to-build`) chosen** → its stories + `state.json` (at `READY-TO-BUILD`) are
  parked on `main`; no branch exists yet. Cut one fresh:

  ```bash
  git fetch origin
  git checkout -b epic/<slug> origin/main       # no remote: git checkout -b epic/<slug> main
  ```

  Invoke `/continue` — it re-enters at `READY-TO-BUILD`, re-checks the parked plan against this fresh
  `main`, and moves into `BUILD`. **Skip B3.** (If the user mentions a *project* fact has changed since the
  plan was parked, land that first — see **"If a project fact has moved"** below.) A parked **design-update**
  epic needs nothing extra here either: the checkout carries the user's edited `documentation/` across, and
  [`/continue`'s READY-TO-BUILD step 2](continue.md#phase-ready-to-build) applies the design on this branch and
  tells the user if it moved since they planned it.

- **Draft or new chosen** → the epic is **already chosen at B1**, so skip [`/plan`](plan.md) Step 1's
  picker and set it up for a build-through:
  - **New epic** → gather its inputs as in [`/plan`](plan.md) **Step 2** (describe it, then infer and
    confirm project-level facts + dependencies), then land the plan row + brief on `main` via the
    [§6.1 main-landing write](../policies/epic-branch-concurrency.md#61-project-level-changes).
  - **Draft** → the brief already exists on `main` and was approved with the epic plan — nothing to land.

  **If a project fact has moved** — Step 2's inference concluded it (its *"A project fact changes"* branch),
  or the user says so on a draft or already-planned epic — land it on `main` via the §6.1 main-landing write
  **before** cutting the branch, so the fresh branch carries the new fact. For a **new epic** that's the same 
  write as the plan row + brief — just include `generated-docs/project.md` (and `generated-docs/design/`, if a 
  digest decision was recorded) in the commit. For a **draft** or **already-planned** epic it's a write of its own:
  **§6.1 steps 2–5 only**, since no `epic/<slug>` branch exists yet and the `git checkout -b epic/<slug>
  origin/main` below is what picks the change up. The two limits on this write — it never regenerates
  design tokens and never verifies backend connectivity — are
  [§6.1's, shared by all three triggers](../policies/epic-branch-concurrency.md#61-project-level-changes);
  read them there rather than through another command's copy.

  **If this epic updates the design** (the user edited their design files in `documentation/` and is
  rebuilding screens to match — they say so in their description; nothing auto-detects), it takes a
  **branch-only** variant of the New-epic flow, because the design source may not touch `main` until the
  rebuild lands (the [§6.2 design-source carve-out](../policies/epic-branch-concurrency.md#62-shared-evolving-artifacts--pr-time-conflict-resolution)).

  (This is the build-it-now path. One the user planned ahead with `/plan` arrives as an already-planned epic
  above, and its design work happens at [READY-TO-BUILD](continue.md#phase-ready-to-build) instead — same
  carve-out, same branch, just a step later.)

  The shared mechanics are in [design-update.md](../shared/design-update.md); this path owns the sequencing
  below. Override the New-epic bullet above: **do not** land the brief on `main` up front, and **do not** add an
  `epic-plan.md` row (a design update is reactive, not part of the up-front decomposition). Instead, in order:
  cut the branch (below) — the user's uncommitted `documentation/` edits come across with it — then
  [refresh the digest on the branch](../shared/design-update.md#refresh-the-digest-on-the-branch), and only then
  write the brief (`intake-agent` `epic-only`) against the **fresh** digest, surfacing the interpreter's
  Uncertainties in the brief approval.

  **[Tell the user what moved](../shared/design-update.md#tell-the-user-what-moved)**, from
  `git diff generated-docs/design/digest.md` — alongside the brief.
  Ask any `CONFLICT:` uncertainty as its own question rather than folding it into that summary, and record each
  answer per [design-update.md](../shared/design-update.md#recording-a-conflict-answer) — this is the
  write-straight-to-the-digest case. If there was no digest before this run, add
  [that message](../shared/design-update.md#no-digest-before-this-run) to the same one.

  [What rides the branch](../shared/design-update.md#what-rides-the-branch) lands on `main` atomically at merge,
  and `git branch -D` discards the whole update. Then hand to `/continue` as normal (Step B3).

  Then create the branch from the latest `main` and initialise state:

  ```bash
  git fetch origin
  git checkout -b epic/<slug> origin/main       # carries any plan row + brief just landed; and, for a design update, the user's uncommitted documentation/ edits
  node .claude/scripts/epic-state.js --init --name "<epicName>" [--depends-on <dep-slug> ...]
  # design update: also refresh the digest (design-interpreter) + write the brief here, then include
  # generated-docs/design/ documentation/ (+ generated-docs/project.md web/src/app/globals.css if colours changed) in the add below
  git add generated-docs/epics/<slug>/
  git commit -m "docs(<slug>): start epic"
  git push -u origin epic/<slug>                # best-effort; skip silently if no remote
  ```

  (No remote: `git checkout -b epic/<slug> main`.) `epic-state.js --init` writes `state.json` at
  `phase: PLAN`; verify `"status": "initialised"`, else STOP and report.

  **If the chosen epic is blocked** (a dependency not yet merged), warn the user before proceeding,
  because unlike `/plan`, `/start` builds **now**: branching from `main` means the dependency's in-flight
  code isn't present, so PLAN/BUILD run against a tree missing the shared model/component/endpoint this
  epic was scoped on. Expect BUILD to **halt** if it hits the missing pieces, and a rebase once the
  dependency merges. Only continue if they confirm; otherwise recommend a `ready` epic, or building the
  dependency first.

### Step B3: Hand off to /continue (build-through)

One line to the user (*"Starting on <Epic name>."*), then invoke `/continue`. It runs the PLAN routine and — because this is `/start`, not `/plan` — takes the **BUILD** exit (`PLAN → BUILD`), building the epic through to EPIC-END. The only difference from `/plan` is the exit: `/start` builds, `/plan` parks.

---

## Notes

- **Phase-context hooks** — `inject-phase-context` provides post-compaction snippets for the long-running phases (`plan`/`build`/`epic-end`); it derives the snippet name from `state.json.phase` and no-ops when none exists. INTAKE runs before the branch exists, so it has no snippet.
- **Continuous flow** — `/start` chains into `/continue` directly once the epic branch is created (cut fresh from `main`, including for a parked `ready-to-build` epic).
- **Plan vs build** — `/start` **builds** (planning inline when an epic isn't parked yet); [`/plan`](plan.md) **plans ahead and parks** an epic at `READY-TO-BUILD` on `main` for `/start` to build later (cutting a fresh branch from `main`), including from a parallel session. One shared PLAN routine ([continue.md → Phase: PLAN](continue.md#phase-plan)); the commands differ only at the exit.
- **State authority** — per-epic `generated-docs/epics/<slug>/state.json` on the epic branch is the source of truth for phase and progress (resolved via `resolve-state-path.js`). `/continue` re-enters at whatever phase it shows.
