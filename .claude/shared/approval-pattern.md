# Approval Pattern

Shared display-then-ask-then-revise pattern used by the INTAKE and stories approvals (and any future approval that signs off a generated document). Both use the same shape — the caller fills in three parameters and any approval-specific branches.

## Parameters Each Caller Provides

| Parameter | Description | Example (INTAKE approval) | Example (stories approval) |
|---|---|---|---|
| `<approval_name>` | Short label for AUQ headers | "Approve project + plan" (Case A) / "Approve brief" (a later epic) | "Approve stories" |
| `<artifact_path>` | Path to the file(s) under review | `generated-docs/project.md` + the epic plan (Case A) or the epic's `generated-docs/epics/<slug>/brief.md` (a later epic) | `generated-docs/epics/<slug>/stories/` (per-story files written on approval) |
| `<headline_template>` | Inline template for the headline shown in chat | see the INTAKE-approval headline in `start.md` | see the stories-approval headline in `continue.md` |
| `<revise_call>` | Subagent prompt for applying free-text or direct-edit revisions | `intake-agent` revise — **always with an explicit `target`** (`project.md` or `brief`) and, off the session root, a `workspaceRoot`; Case A **plan** edits go to `feature-planner` `decompose` | `feature-planner` with `revisionFeedback` |

> **`target` is not optional and must not be guessed.** `intake-agent` revise mode requires it and is told never to infer it from the mode or the caller, so a `<revise_call>` launched without one either halts mid-approval or rewrites the wrong artifact — regenerating `project.md`, whose facts every epic inherits, when the user only wanted a wording fix in one brief. Whoever instantiates `<revise_call>` sets `target` from `<artifact_path>`.

> **Case A's INTAKE approval extends this pattern.** It approves `project.md` **+ the epic plan**, so it adds a blocker-clearing pre-step and a plan-specific option set (Approve / Adjust the plan / Adjust project setup / Start over) on top of the display-then-ask-then-revise shape below. The two-step flow is specified in [`start.md` §8](../commands/start.md); follow it there rather than the base options when running Case A.
| `<bounce_back?>` | Optional — extra disposition that routes to a different approval | n/a | n/a |

---

## The Pattern

### Step 1 — Show the headline (MANDATORY)

Output `<headline_template>` as **regular conversation text** *before* calling `AskUserQuestion`. Never embed it inside the question text.

The headline is what the user can judge at a glance: what is being approved and its shape — the name, and one line per item. Nothing more. Acceptance criteria, manual tests, non-goals, design detail and requirement mapping are on the review page only; do not repeat them here.

> **Critical:** The user cannot approve what they haven't seen. The headline plus the open review page is the showing. **Read `<artifact_path>` and build the headline from it**, not from the agent's return. This is the most-violated step.

**Where the approval has a page**, end by pointing at it and saying what to do with it:

```
I've opened the full plan in your browser. Change anything you like there, then click
Approve — it copies your version for you to paste back here. If it's good as it stands,
just answer below.
```

### Step 2 — Ask for approval (ONLY after step 1 text is output)

Call `AskUserQuestion`:
- header: `"<approval_name>"`
- question: caller-specific (e.g., "Does this match what you intend to build?")
- options (3 base + 1 optional bounce-back):
  - `"Approve all"` — description: caller-specific approval action
  - `"I have small changes"` — description: `"I'll describe deltas in my next message"`
  - `"Let me edit the file directly"` — description: ``"I'll open <artifact_path> and edit it"``
  - *(stories approval only)* `"Start over"` or `"The underlying assumption is wrong"` — see Bounce-Back below

### Step 3 — Branch on the response

- **Approve all** → proceed past the approval.

- **I have small changes** → ask plain-text: `"Describe your changes — I'll apply them and show you the diff before committing."` Launch `<revise_call>` with the user's feedback. After it returns, display the diff (`git diff <artifact_path>`) and re-ask: ``"Look right?"`` (`AskUserQuestion`: `"Yes, approve"` / `"More changes"` / `"Let me edit the file directly"`).
  - "Yes, approve" → proceed past the approval
  - "More changes" → loop once more (2-round cap, then force-route to "Let me edit the file directly")
  - "Let me edit the file directly" → see next branch

- **Let me edit the file directly** → tell the user: ``"Open <artifact_path>, make your edits, and tell me when you're done."`` Wait for the user to signal "done". Re-read the file, display the diff, run `<revise_call>` with a "user edited directly — re-read and validate" hint. Re-display the updated summary; re-ask: `"Approve"` / `"More changes"`. Loop until approved.

- **(Bounce-back, if defined)** → see Bounce-Back below.

Loop the branches above until the user approves. Then exit the approval.

---

## Free-Text Revision Cap

The free-text delta loop is capped at **2 rounds**. If the user is still not approving after round 2, force-route to "Let me edit the file directly" — at that point the contradictions are too dense for the agent to resolve from prose alone.

## Bounce-Back (stories approval only)

When the user's revision at PLAN is "the underlying brief is wrong" rather than "the epic/story wording is wrong", route the revision back to INTAKE instead of re-running the planner:

1. Display: ``"Got it — let's fix the brief. I'll re-open the epic's `brief.md` (or `project.md` if the issue is project-level) so you can correct it, and we'll regenerate the stories once the change is in."``
2. Re-enter the INTAKE approval with the user's feedback as input to `intake-agent` revise mode, with `target` set to whichever artifact step 1 established is actually wrong — `brief` or `project.md`. This is the one branch where the artifact genuinely is ambiguous, which is exactly why the agent won't pick for you.
3. After the INTAKE re-approval, regenerate the epic/story proposal via `feature-planner` and re-enter the stories approval.

---

## Editable HTML Review Page (plan approvals)

At **both plan approvals** — the **epic-plan approval** ([`start.md` §8b](../commands/start.md), on `main`) and the per-epic **stories approval** ([`continue.md` §P2](../commands/continue.md), on the `epic/<slug>` branch) — in addition to the in-chat summary, render the review page with a script and open it in the external browser. This is the user's preferred way to review and approve a plan.

**You build the payload; the script builds the page.** Layout, editing controls, reordering, the collapsed detail disclosures, the clipboard hand-off and the visual style are all fixed — don't hand-write a page.

Write the payload with `Write`, to `review-payload.json` beside the page (both names are git-ignored):

```bash
# epic-plan approval (on main)
node .claude/scripts/render-epic-plan-review.js --in generated-docs/review-payload.json \
  --out generated-docs/epic-plan-review.html

# stories approval (on the epic branch; /plan passes its worktree path to --out instead)
node .claude/scripts/render-stories-review.js --in generated-docs/epics/<slug>/review-payload.json \
  --out generated-docs/epics/<slug>/stories-review.html

node .claude/scripts/open-page.js "<the --out path>"
```

`--in` is required (`--in -` reads the payload from stdin). Each script resolves a relative `--out` against the repo root and prints `{"status":"ok","page":"…"}`. Payload shapes are documented in each script's header comment. On script failure, output a one-liner and fall back to the in-chat approval. Open in the **external browser** (`open-page.js`), never the VS Code Simple Browser — the embedded webview blocks clipboard-copy and downloads, and can't be auto-opened.

**What the payload must carry (this part is your judgment):**

1. **Only what the user decides at this approval** — the epic list, or the one epic and its stories. Never completed or unplanned epics. At the **stories** approval, roadmap context goes in `position` (`{ index, total, completed }`), which becomes a header pill and a progress bar; nothing more. (The epic-plan page has no `position` — it *is* the whole plan, and titles its own pill from the epic count.) The page is a focused decision surface.
2. **Plain, user-facing language** — the planner's Translation Rule already produced it. No coverage tags, requirement IDs, `targetFile`, or routes. Give each story a plain `scopeCue` ("New screen", "Updates the Transactions page") and its `roles`; the real route still travels in the approval payload for the build, not on the page.
3. **Design choices — only the ones that genuinely need the user.** Omit a decision if **either** holds: you're ≥80% sure of the right answer (pick it, apply it as a default), or it's answerable from the design source, brief, design system, or sample data (follow that source). What's left — genuinely open, consequential, unresolved by any source — is the only thing worth asking. If that set is empty, send `designChoices: []` and no section renders. Don't manufacture choices, don't pad with formatting the design system already governs, and don't re-ask what an earlier epic settled. Tell the user briefly which defaults you applied and why.

   **Give each option a real, rendered example — not just a label.** Author a small mockup per option in `options[].previewHtml`, using realistic sample data and the already-applied format defaults (an actual mini table, the real interaction wired up). A one-word label isn't enough for a decision that genuinely needs attention. This is the one part of the page that can't be templated, which is why it travels as data.

   **Name your recommendation in `recommended`** (the label of the option you'd pick). The script renders it pre-selected, so a user who agrees can approve without touching anything.

When the user approves, fold any `designChoices` into the per-story context the developer receives (and, if a choice resolves a spec gap or sets a cross-epic convention, record it in the epic's `brief.md` — or `project.md` for a project-wide convention — so later epics stay consistent). **A choice that answers an open design-digest Uncertainty is also recorded in the digest's Your Decisions section** — see below.

Both pages and both payloads are git-ignored and regenerable.

## Recording a decision that overrides the design

**Only applies when a design digest exists** (`generated-docs/design/digest.md`) — skip entirely on projects with no design. The orchestrator writes these; no agent does.

**Why this exists.** The digest is what the developer builds every screen from, and it's re-read from `documentation/` whenever the design changes. So anything the user settled that *isn't in their design files* has to live in the digest itself — otherwise the next read finds the design's version and quietly rebuilds the screen back to it, undoing what they asked for.

**Where.** The **Your Decisions** section at the top of `generated-docs/design/digest.md`. The interpreter always writes that section, so it's normally there to append to — replace its "nothing yet" line with your first bullet. (On a digest written before this existed, add the section above `Screens` yourself.)

```markdown
- **[Screen or topic] — [what was decided, in the user's terms]** *(<epic slug, or "intake">, <YYYY-MM-DD>)*
  [Optional: the question or design detail it overrides.]
```

**Record a decision at these four moments:**

| When | What triggers it | Example |
|---|---|---|
| **Stories approval** | A `designChoices` selection that answers an open digest **Uncertainty** | "Export on Dashboard → goes to the Reports screen" |
| **INTAKE approval** | An "Adjust project setup" answer that fills a gap the design files didn't have | "Brand primary is `#0F62FE` — you told us; not in the files" |
| **Project change touching §Styling** — any trigger: `/plan`, `/start`, or mid-BUILD ([§6.1 step 3](../policies/epic-branch-concurrency.md#the-main-landing-write-single-developer-default)) | A §Styling change that **contradicts** the digest's palette or typography — the user tells us a new brand colour rather than editing their design files | "Brand primary is now `#0B5FFF` — supersedes the design's `#E6007E`" |
| **Manual-test approval** ([continue.md § Fix-cycle integration](../commands/continue.md#fix-cycle-integration), step 4a — which owns the bug-vs-decision test) | A change the user asks for that **deliberately differs** from the design. Never a bug fix | "Orders filter sits on the right, not above the table — your call while testing" |

**Rules:**

- **Append, never rewrite.** If the user changes their mind later, append; the last entry on a topic wins. Append-only is what keeps this Tier 1 additive-union when two epic branches both record decisions (see [epic-branch-concurrency.md §6.2](../policies/epic-branch-concurrency.md#62-shared-evolving-artifacts--pr-time-conflict-resolution)).
- **Strike an entry** (`~~wrap~~` it, dated, never delete) **only when the user says the new design wins** — after the interpreter flags a design-vs-decision conflict and they choose the design. Appending instead would record the *opposite* of what they chose, because this section outranks the design on every future read, and would leave the superseded bullet standing beside it.
- **When the answer is captured now and applied later**, carry which way it went with it. A `/plan` conflict is answered at plan time and written to the digest at build time ([plan.md Step 3c](../commands/plan.md#step-3c-lay-down-the-plan-skeleton) stores `epic.designDecisions`), so each entry records an `outcome` of `"decision-stands"` (append the line) or `"design-wins"` (strike the bullet named by `supersedes`, and append nothing). A bare line can only be appended, which silently turns every *design wins* answer into its opposite.
- **Commit it with whatever else that step commits** — the intake commit at INTAKE, the story-files commit at PLAN, or the next B5 story commit when it came from the manual-test fix cycle. Each of those stages the digest conditionally; you don't need a commit of your own.

## Manual-Test Check-off Page (manual-test approval)

At the **manual-test approval** ([`continue.md` §B7.1](../commands/continue.md)), render the check-off page with the script and open it in the external browser — **always, instead of an in-chat checklist.** The in-chat version is the fallback when the script or the open fails.

```bash
node .claude/scripts/render-manual-tests.js --in generated-docs/epics/<slug>/review-payload.json \
  --out generated-docs/epics/<slug>/manual-tests.html
node .claude/scripts/open-page.js "generated-docs/epics/<slug>/manual-tests.html"
```


**What the payload must carry (this part is your judgment):**

1. **The check-these-first ledger.** Pass `state.json.epic.unverifiedAssumptions` as `unverifiedAssumptions`; the script renders it above everything else, because these are the real-backend assumptions the automated tests couldn't verify. Omit the field when the array is empty. Each item is a plain string, or `{ text, priorPassed }` when a re-display needs to carry a confirmed one forward (step 5).
2. **Order the groups to minimise persona-switching.** The script renders the order you give it. Group all same-role checks together and put the single sign-out/sign-in for another role in **one** section at the end — never make the user log in and out repeatedly. Consolidate repeated negative checks ("role X can't see Y") into one short section rather than repeating them per story.
3. **One crisp *do this → expect that* line per check**, in plain language.
4. **Attach setup to the check it belongs to**, via that check's `setup` field — never a page-level banner the reader has to connect to the right test. When several checks share a setup, put it on the first and have the rest point at it. Where the values are already documented canonically — `web/.env.example`, the story file, the e2e spec — point there rather than restating them, so the hint can't drift from its source.
5. **Pre-tick from prior results on a re-display.** After a fix cycle, set `priorPassed: true` on every check whose prior result in `state.json.epic.manualTestResults` was `passed: true`, leaving **only the affected checks** unticked — the reported failure(s), every check belonging to a re-entered story, and (for a contract correction) the failed assumption plus the consuming stories' checks. Ledger items take it too, as `{ text, priorPassed }`, so a confirmed assumption doesn't come back unticked. On first display, send no `priorPassed` at all.
6. **`appUrl`** renders the "Open the app" button; **`logins`** renders one click-to-copy chip per role. Omit `logins` unless you have real sign-in details to copy.

**Orchestrator handling of the result:** `allPassed: true` (or `all passed`) → mark the epic manual-test passed and transition to `COMPLETE-ON-BRANCH`. Otherwise → route each `failed` item (its `comment` + `story`) through the existing [§B7.1 fix-cycle integration](../commands/continue.md#fix-cycle-integration), re-rendering the page after the fix. Each item's `kind` says which branch it takes — `"assumption"` is a ledger item (data-contract failure, `story` is `null`), `"story"` is a per-story check. A non-empty `todo` is **not** a bug report — those checks have nothing to act on; ask the user whether they still want to run them or move on. Skip the page only for infrastructure-only stories / legacy epics, as today.

## Visual Style and Page Wording

Owned by [`lib/review-page.js`](../scripts/lib/review-page.js) and the three renderers, shared by all three pages — light, calm and airy, one accent colour, soft cards whose shadow deepens on hover (nothing moves), a short framing header with a progress bar, fully self-contained (no CDN, no external assets). To change how every review page feels, change that module; never restyle a single generated file.

**The pages' own wording is fixed in the renderers too** — headings, button labels, the "tick what works" instructions — so you don't re-derive it per run; the text you write at an approval is the *in-chat* summary and the payload. If a user asks for different wording **on the page**, change the renderer so every future page carries it, rather than editing one generated file.
