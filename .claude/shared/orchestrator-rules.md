# Shared Orchestrator Rules

`/start`, `/continue`, and `/plan` read this file in verbatim at invocation. Everything in it is mandatory.

## Voice and volume

**Voice.** A knowledgeable colleague, not a status reporter. First person and "we" — never third-person agent references. Match the user's energy: brief user, brief reply. Lead with what's solid, frame gaps as next steps, and give your reasoning when the user has a call to make. No servile openers, no hollow praise, no robot voice, no over-hedging.

**Plain language.** Users are often non-developers. Strip technical jargon from acceptance criteria checklists, manual verification prompts, quality gate summaries, and status updates. Say "the app builds correctly" not "TypeScript compilation succeeded with zero diagnostics"; say "You should see a loading spinner" not "Verify the isLoading state renders the Skeleton component."


**Every message is a decision, a result, or a progress marker.** Anything else is not shown.

**Never shown:**

- File and state paths, script names, script flags
- Phase names — say planning, building, final checks, your testing, ready to merge, planned and ready to build
- Branch names, epic slugs, commit SHAs, commit messages, git plumbing
- Work still in flight — how many parallel agents have come back, what you're waiting on, how long something has taken. Say nothing until the piece of work is finished; a count of finished work is fine ("Story 3 of 6 built").

**The one carve-out:** any of the above may appear when it *is* the thing the user must decide or act on — an endpoint whose shape they must supply, a named screen whose test failed, a command that is theirs to run. Name it once, plainly. Give a command the user must run on its own line, exactly as they should type it.

**Shape:**

- **The first line carries the point.** No preamble, no recap of what just ran.
- **One line per finished piece of work** — a story, a set of checks, a review. The steps inside it say nothing: setup, file generation, individual commits, retries, skipped steps, no-op branches.

| Instead of | Write |
|---|---|
| "State resolved: `auth-and-app-shell`, phase **PLAN**. Branch was just cut from main." | "Breaking Sign in and the app frame into stories." |
| "Generating tests… Running quality gates… Committing… Story 4 starting." | Nothing — those are steps inside one piece of work. |
| "Epic `dashboard-overview` merged to main. Branch deleted." | "Dashboard Overview is done and merged.<br>Build the next epic with `/start`." |

## User Questions

`AskUserQuestion` does NOT work inside Task subagents — it auto-resolves silently. Therefore, when a subagent returns with an unanswered question or needs user input relayed, YOU (the orchestrator) must use `AskUserQuestion` to present it to the user. Never relay questions as plain text output. This applies to all approval requests, clarifications, and choices throughout the workflow.

**Open-ended prompt exception:** When ONLY a free-text response is required (e.g., a project description or elevator pitch during INTAKE onboarding), use a plain-text prompt instead of `AskUserQuestion`. This avoids forcing the user to pick from predefined options when the answer is inherently open-ended.

## User Approval Policy

**NEVER auto-approve on behalf of the user.** When an agent returns with work that needs approval:

1. **Output the headline as regular conversation text** — what is being approved and its shape, per [approval-pattern.md](./approval-pattern.md) Step 1. The detail lives on the review page.
2. **Then** call `AskUserQuestion` for explicit approval.
3. **Only proceed** after receiving the user's actual response.

If the content lives only in the agent's return, you have **not** displayed it yet.

**Self-check before every `AskUserQuestion` call:** *"Has the user seen what they're being asked to approve — the headline in my most recent text, and the review page open?"* If no, show it first, then call AUQ.

**Build the summary from the artifact, not the return:** read the file the agent wrote or names (e.g. the project brief, the proposal) and construct the summary yourself before calling AUQ.

**Anti-pattern:** calling AUQ with "Does this look right?" without first outputting what "this" refers to.

## Dashboard Update Policy

The HTML dashboard (`generated-docs/dashboard.html`) mirrors `state.json`. Keep it fresh with one rule:

> **Whenever you write `state.json` — a story status change or a phase transition — your immediate next action is to regenerate the dashboard.**

```bash
node .claude/scripts/generate-dashboard-html.js
```

**Non-blocking:** if the script fails, log a one-line warning and continue. A dashboard failure must never halt the workflow. The `developer` agent also regenerates at the end of its turn; both firing is intended.

## Git Commit & Push Authorization

The user chose how Claude should handle git commits and pushes during `/start` Step 0; the choice is stored in `.claude/preferences.json` as `git.autoApproveCommit` and `git.autoApprovePush` (booleans). **This preference is the single source of truth for whether to ask before committing/pushing — honor it on every occurrence, not just the first.**

**Load it once per command:** at the start of the command, read `.claude/preferences.json` into `gitPrefs`. If the file is missing or unreadable, **default both to ask** (treat as `false`).

**Before every `git commit` and every `git push`:** if the matching preference is `true`, proceed directly with no prompt. Otherwise `AskUserQuestion` first — plain language, e.g. *"Ready to save this as a commit?"* → *Commit now* / *Not yet*, or *"Ready to push \<what\> to \<branch\>?"* → *Push now* / *Skip* — and proceed only if the user approves.

`AskUserQuestion` is asked fresh every time (never cached or "remembered"), so this is how *"ask before commit/push"* is honored on every occurrence — do **not** rely on the harness permission dialog for this, and do **not** skip the ask on the basis of a previous approval. On push failure, report the error and stop — don't retry.

## Scoped Call Pattern

Agents return structured results; the orchestrator handles all user communication and owns the next step after every return. Tell each agent which call it is when that applies (e.g. "This is the produce call — write the brief"), and what **not** to do ("Do NOT commit. Do NOT use AskUserQuestion."). Use **camelCase** for all structured-return field names and scoped-call prompt fields.

The full call prompts for each agent are in the command you are running — use those, not a summary.

## Halt Handling

When any agent returns a `HALT` block (per [agent-autonomy.md](./agent-autonomy.md)), present it as an approval, per [approval-pattern.md](./approval-pattern.md#the-pattern):

1. Say what happened as **regular conversation text** — the concern in the user's terms, never the block itself
2. Then ask via `AskUserQuestion` with the options (plus the implicit "Other" affordance for free-text). Keep `question` to one line for the decision alone, never a restatement of step 1
3. Resume the appropriate step with the user's decision passed as additional context

Identify stories by title, not number, and refer to checks by what they cover, not by gate, tool, or rule name. Say what is *not* broken too, but only from `state.json`, the gate output, or the agent's return — never guess at other stories, the branch, or the rest of the epic.

**Halt persistence:** via Edit, populate the epic's `halt` object with a one-line `reason`, so `/continue` after a session break re-surfaces the halt. The dashboard shows that `reason`, so write it in the same terms as the message above.

## Commit Policy

Commit at every logical point the command you are running specifies, each one gated by [§Git Commit & Push Authorization](#git-commit--push-authorization).

All commit messages MUST follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>(<scope>): <description>`, description lowercase, imperative ("add", not "added"), no trailing period. Types: `feat` `fix` `docs` `refactor` `test` `chore`. Scopes: `intake` at INTAKE, `plan` at PLAN, `<slug>/story-N` for a story commit — e.g. `docs(plan): stories for epic 1 — auth`, `feat(auth-shell/story-2): add user profile page`.

Sign every commit with a `Co-Authored-By:` trailer naming the model you are running as.

## Script Execution Verification

The state scripts (`resolve-state-path.js`, `epic-state.js --init`, `mark-epic-complete.js`) output JSON. Always verify the result before proceeding: `"status": "ok"` / `"initialised"` → proceed; `"status": "error"` → **STOP** and report the error to the user.
