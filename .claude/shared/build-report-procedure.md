# Build-report procedure (shared)

The steps common to **`/build-report-maintainer`** and **`/build-report-stakeholders`**. Both
reports come from the same collector and generator; only the audience, the editable insight
prompt, and one extra authored section differ. Those differences live in each skill's own
`SKILL.md` — everything here is identical for both, and lives in one place so the two can't
drift apart.

Each skill tells you its **audience**, its **insight brief** (a section in that skill) and its
**insight output file**. Substitute those below wherever you see `<audience>`, `<insight brief>`,
`<insight file>`.

Both reports are **display-only**: never modify workflow state, run tests, or resume the
workflow.

---

## A. Refresh the log-derived data

Both audiences read data files produced from the session logs — the maintainer report for its
cost, involvement and effort-benchmark panels, the stakeholders report for the decision log
behind its sign-off section. Refresh them **best-effort, never blocking**, and pass the **same**
`--rate` and `--exclude` to both so the panels on one page can't disagree:

```bash
node .claude/scripts/generate-build-cost-report.mjs [--rate=<ZAR_RATE>] [--exclude=<ids>]
node .claude/scripts/generate-build-effort.mjs [--rate=<ZAR_RATE>] [--exclude=<ids>]
```

The second one writes `build-effort-data.json`, which drives the maintainer page's **Effort
benchmarks** section (per-screen-type medians, the per-feature roll-up and the sizing
calculator). If it reports `costComplete: false`, the project's sub-agent transcripts weren't
captured: the section renders **time only** and says so — report build time and tell the user
cost was unavailable rather than quoting any per-story figure. It is not needed for the
stakeholders page, which shows no effort or cost breakdown.

- **`--rate` is maintainer-only — give both generators the same one.** The maintainer page shows
  cost in rand in several places, and they should all come from one rate. (If the effort run
  misses it the page still holds together — it falls back to the rate the cost data carries — but
  pass it to both anyway rather than relying on that.) Without any `--rate` the cost generator
  uses a fixed placeholder rate and the page says so on its face; the dollar figures are unaffected.
  The stakeholders page shows no cost, so run without a rate there and skip the effort generator
  entirely.
- **`WARNING: unknown models priced as Opus 4.8` means the cost figures are estimates, not
  exact.** Look the model's real pricing up (the `claude-api` skill has the current table), add
  it to `PRICING` in `.claude/scripts/lib/report-core.mjs` and re-run. If you can't, the page
  banners the affected sections on its own — but **say so in your summary too**; never present
  an estimated figure as a measured one.
- **Exclude sessions that aren't part of the build.** The script auto-flags sessions whose
  first command is a report command, but an analysis conversation that began with free text is
  **not** caught — and on a client-facing page its questions would surface as product
  decisions. The page's **Data quality** section names every session folder that was read; list
  the transcripts in each with `ls ~/.claude/projects/<folder>/*.jsonl`, then
  identify any you don't recognise by reading the opening messages of each — use `Grep` on the
  `.jsonl` for `"type":"text","text":"` (per CLAUDE.md §10, not `grep` via Bash). Pass the
  unrelated ones with `--exclude=<id1>,<id2>`.

  Note whatever it reports as `postDeliverySessionsExcluded` — those are sessions it recognised
  as report or dashboard runs and left out of the build totals by itself. Check the list looks
  right and mention it in Step F; if one of them was really part of the build, re-run the cost
  generator with `--keep=<id>` to put it back. The effort generator reads that same list from the
  cost data file, so both panels on the page count the same sessions — which is the other reason
  to run the cost generator first.
- **If a script exits non-zero, the exit code says whether to stop** — two very different
  situations both fail here, and the code separates them:
  - **Exit 3 — there is no project to report on yet** (no `generated-docs/epics/`, or no readable
    `state.json` in it). Say so, point the user at `/start`, and **stop**: the remaining steps
    would each fail the same way.
  - **Any other non-zero — an optional input is missing.** `Transcript directory not found…` (the
    build ran on another machine), no stories carrying timestamps, or anything similar —
    **continue anyway.** The report still renders: the Data quality section names whichever input
    is missing, the cost and effort panels drop out on their own, and on the stakeholders page the
    sign-off section simply disappears.

  Read the message too, for your Step F summary — but branch on the code, not on the wording.

## B. Generate the metrics and collect the data

```bash
node .claude/scripts/generate-build-report-html.js --collect --audience <audience>
```

Read the JSON it prints:

- `status: "no_project"` → no project yet; suggest `/start`. **Stop.**
- `status: "legacy_detected"` → suggest `/migrate-legacy`. **Stop.**
- The script itself fails → report the actual error and suggest checking `.claude/scripts/`. **Stop.**
- `status: "ok"` → the metrics HTML and `generated-docs/reports/build-report-data.json` are written. Continue.

## C. Write the insight panel

Read **`<insight brief>`** in the calling skill and follow it exactly. Treat
its current wording as the instruction — don't substitute your own structure or headings. It
tells you what to read and to write the result to **`<insight file>`**.

Ground every statement in the data. **Never invent a number or an event.** If a figure in the
data is a floor or an artifact (an active-time estimate, a cost total missing its sub-agent
share, a calendar span inflated by later maintenance), say so in the same sentence rather than
presenting it as exact — a report that quietly overstates is worse than one that qualifies.

Check the existing insight file before overwriting it: if it was authored against older data,
its numbers will contradict the freshly computed metrics on the same page.

## D. Regenerate so the authored panel is included

```bash
node .claude/scripts/generate-build-report-html.js --collect --audience <audience>
```

The generator picks up the audience's insight file automatically and renders it as the top
panel. It prints `insights: included` — if it still says `none`, the file wasn't written where
the prompt said. (For metrics only, run with `--no-insights` and skip Step C.)

## E. Open it

```bash
node .claude/scripts/open-page.js "<the html path the generator printed>"
```

## F. Confirm

If the open command exited non-zero it could not launch a browser here (headless Linux, a
container, a stripped-down WSL install) and printed the report's full path. Give the user that
path to open themselves instead of saying the report is open — then carry on with the summary.

Tell the user the report is open and give a **two-line** spoken summary — each skill says what
to lead with. Mention in one clause if Step A excluded any sessions. Then remind them they can
reshape the written panel any time by editing **`<insight brief>`** in the skill and re-running the command.

---

## DO

- Report errors to the user — this is synchronous, they triggered it explicitly.
- Base the insight panel only on the computed data and the journals/feedback.
- Open the browser after the second generation pass.

## DON'T

- Modify workflow state, run tests, or resume the workflow — display-only.
- Invent metrics, durations, or events not present in the data.
- Rewrite the insight brief's structure — follow it as the skill has it.
- Show raw JSON to the user.
