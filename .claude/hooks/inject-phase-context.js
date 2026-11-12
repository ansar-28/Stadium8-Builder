#!/usr/bin/env node
/**
 * inject-phase-context.js
 *
 * Post-compaction hook: restores workflow instructions after auto-compaction.
 * Fires via SessionStart (matcher: "compact") in the orchestrator session.
 *
 * Reads per-epic state.json (resolved via resolve-state-path.js) and injects:
 *   Tier 1 - Workflow coordinates (always)
 *   Tier 2 - Orchestration rules (not in CLAUDE.md, lost on compaction)
 *   Tier 3 - Recency reinforcement (observed drift points)
 *   Phase-specific process steps from phase-context/*.md
 *
 * Output: JSON with hookSpecificOutput.additionalContext
 * Fail-safe: exits 0 with no output when not on an active epic branch.
 *
 * Port of inject-phase-context.ps1 — see lib/workflow-state.js for why.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  projectRoot,
  activeEpic,
  storySummary,
  resolveStoryAndTestFiles,
  emitContext,
  runHook,
} = require('./lib/workflow-state');

const ORCHESTRATION_RULES = `
## Orchestration Rules (post-compaction recovery)

### Phase Model
PLAN -> BUILD -> EPIC-END -> MANUAL-TEST -> COMPLETE-ON-BRANCH -> COMPLETE.
An epic may also be parked at READY-TO-BUILD (between PLAN and BUILD) when planned ahead via /plan; /start or /continue then builds it.
State authority lives in generated-docs/epics/<slug>/state.json on the active epic/* branch.
Project-level facts (roles, auth, data source, compliance, styling) live in generated-docs/project.md on main.

### Approvals
1. INTAKE approval -- end of INTAKE: approve project.md + epic plan (first project) or just the epic brief.md (a later epic).
2. Stories approval -- end of PLAN: approve the stories for this epic.
3. Manual-test approval -- end of MANUAL-TEST: approve before opening the PR.
4. User-approved merge -- end of COMPLETE-ON-BRANCH: orchestrator never auto-merges.
The workflow chains continuously between approvals.

### Agent Autonomy
The BUILD agent (developer) resolves standard decisions itself and halts only for categories in .claude/shared/agent-autonomy.md ("Always halt"): permission changes, API contract modifications, undocumented API usage (endpoint/param/header/body not in the OpenAPI spec — halt category undocumented-endpoint, which you surface via the four-option menu in continue.md §B3), new dependencies, state/data-fetching library swaps, auth flow changes, cross-cutting architecture, project.md contradictions, CLAUDE.md policy contradictions, missing Playwright spec for a routable story.

Halts that propose changes to project.md include requiresProjectChange: true; the orchestrator routes those through the .claude/policies/epic-branch-concurrency.md §6.1 project-change flow instead of surfacing to the user.

### User Approval Policy
Output proposed content as conversation text BEFORE calling AskUserQuestion. Never auto-approve on the user's behalf.`;

const QUALITY_REMINDERS = `
## Quality Reminders
- the orchestrator runs a light gate inline per story (--checks lint,test-quality); the developer already ran full Vitest + typecheck
- the full /quality-check suite (build, TypeScript, full Vitest, security) runs once at epic-end, inline (Step B7.0), then a /code-review --fix pass via the code-review-runner subagent (Step B7.0.5) — invoke the runner, do not run /code-review inline — before E2E and manual testing
- Playwright runs once at epic-end, last, against the production build the quality-check produced (Step B7.0.6), not per story`;

/** Tier 1: workflow coordinates. */
function buildCoordinates(resolution, state, files) {
  const { total, complete, inProgress, halted } = storySummary(state);
  const epicName = (state.epic && state.epic.name) || resolution.slug;
  // A halt leaves no story in-progress. Naming it — and saying it halted — is what
  // stops a resumed session from reading "no current story" as "start the next one"
  // instead of re-surfacing the halt (phase-context/build.md).
  const storyNumber = inProgress ?? halted;
  const storyLine = storyNumber
    ? `${storyNumber} of ${total} (${complete} complete)${halted && !inProgress ? ' — HALTED, re-surface the halt' : ''}`
    : 'N/A (epic-level phase)';

  const lines = [
    '## Current Workflow Position',
    `- Epic: ${resolution.slug} (${epicName})`,
    `- Branch: ${resolution.branch}`,
    `- Phase: ${state.phase}`,
    `- Story: ${storyLine}`,
  ];
  if (files.storyFile) lines.push(`- Story file: ${files.storyFile}`);
  if (files.testFile) lines.push(`- Test file: ${files.testFile}`);
  return lines.join('\n');
}

/**
 * Phase-specific snippet, named after the lowercased phase (BUILD -> build.md).
 * Returns '' when the phase has no snippet — INTAKE runs before the branch
 * exists, and COMPLETE/READY-TO-BUILD have none.
 *
 * The phase is checked against the shape a phase name actually has before it is
 * used as a filename: it comes from state.json, and interpolating an arbitrary
 * value here would let a `../..` phase read any file on disk straight into the
 * orchestrator's context.
 */
const PHASE_NAME = /^[A-Za-z][A-Za-z-]*$/;

function buildPhaseSnippet(hookDir, phase) {
  if (!phase || typeof phase !== 'string' || !PHASE_NAME.test(phase)) return '';
  try {
    const snippetFile = path.join(hookDir, 'phase-context', `${phase.toLowerCase()}.md`);
    return '\n' + fs.readFileSync(snippetFile, 'utf8').trimEnd();
  } catch {
    return ''; // snippet missing or unreadable
  }
}

function buildContext(root, hookDir, resolution, state) {
  const files = resolveStoryAndTestFiles(root, state, resolution.slug);
  return (
    buildCoordinates(resolution, state, files) +
    ORCHESTRATION_RULES +
    QUALITY_REMINDERS +
    buildPhaseSnippet(hookDir, state.phase)
  ).trimEnd();
}

function main() {
  const root = projectRoot();
  const active = activeEpic(root);
  if (!active) process.exit(0);

  emitContext('SessionStart', buildContext(root, __dirname, active.resolution, active.state));
}

if (require.main === module) {
  runHook(main);
}

module.exports = { buildContext, buildPhaseSnippet };
