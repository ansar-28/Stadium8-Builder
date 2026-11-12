#!/usr/bin/env node
/**
 * workflow-guard.js
 *
 * UserPromptSubmit hook: injects workflow state context on every user prompt so
 * Claude can redirect users who attempt development work outside the /start and
 * /continue flow.
 *
 * Resolves state via .claude/scripts/resolve-state-path.js (required as a
 * module) — works on any branch, including main, where there's no active epic.
 * That resolve is LAZY (see buildGuardMessage): it runs on every user prompt, so
 * the branches that don't need it must not pay for the git lookup it does.
 *
 * Output: JSON with hookSpecificOutput.additionalContext
 * Fail-safe: exits 0 with no output on unexpected errors.
 *
 * Port of workflow-guard.ps1 — see lib/workflow-state.js for why. Note the
 * latency footnote the .ps1 version carried no longer applies: resolving state
 * used to spawn `node resolve-state-path.js` (which spawns git), so the hook
 * needed timeout headroom to avoid a mid-run kill that would fail open and let
 * out-of-workflow work proceed unguarded. This runs in-process; only the git
 * lookup remains, and only on the branches that need it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  projectRoot,
  getStateResolution,
  readEpicState,
  storySummary,
  emitContext,
  runHook,
  PROJECT_MD_PATH,
  LEGACY_STATE_PATH,
} = require('./lib/workflow-state');

const DEV_REPO_MESSAGE = `TEMPLATE-DEV REPO: This is the Stadium Builder template source repo, not an end-user project.
- Template maintenance (.claude/, .github/, scripts, policies, docs, CLAUDE.user.md, the publish/sync pipeline) does NOT go through the TDD workflow. Proceed directly; do NOT redirect to /start.
- Use /start only when dogfooding the end-user experience (building a sample app to exercise the workflow). For a faithful test, prefer the release repo (Digiata/Stadium-Builder) over the dev repo.`;

/**
 * Returns the guard message for the current repo state.
 *
 * `resolution` may be a resolution object or a function returning one. It is only
 * consulted from Branch C onwards, so passing the lazy form keeps the branches
 * above it — dev repo, uninitialised project, legacy shape — free of the `git`
 * subprocess resolveStatePath spawns. That matters: this runs on EVERY user
 * prompt. Both forms are accepted so the test suite can hand in a fixture
 * resolution directly and exercise every branch without spawning the hook.
 */
function buildGuardMessage(root, resolution) {
  const resolve = () => (typeof resolution === 'function' ? resolution() : resolution);
  const nodeModulesPath = path.join(root, 'web', 'node_modules');
  const projectMdPath = path.join(root, ...PROJECT_MD_PATH.split('/'));
  const legacyStatePath = path.join(root, ...LEGACY_STATE_PATH.split('/'));

  // Dev-repo sentinel: .release-ignore exists only here (stripped on publish/sync).
  if (fs.existsSync(path.join(root, '.release-ignore'))) {
    return DEV_REPO_MESSAGE;
  }

  // --- Branch A: project not set up (dependencies not installed) ---
  if (!fs.existsSync(nodeModulesPath)) {
    return `WORKFLOW GUARD: Project not initialized. Dependencies are not installed.
Action: Redirect to /start — it handles install and prefs as part of Step 0 before INTAKE.`;
  }

  // --- Branch B: legacy workflow shape (no project.md, but legacy state present) ---
  if (!fs.existsSync(projectMdPath) && fs.existsSync(legacyStatePath)) {
    return `WORKFLOW GUARD: Legacy workflow shape detected.
Action: Redirect to /migrate-legacy to convert this project to the epic-branch workflow.`;
  }

  const stateResolution = resolve();

  // --- Branch B2: on an epic/* branch whose name the resolver rejects ---
  // Distinct from Branch C: the user IS on an epic branch, so "you're not on one,
  // run /start" would be false and would push them into a second epic. Name the
  // real problem instead.
  if (stateResolution && stateResolution.status === 'error' && stateResolution.branch) {
    return `WORKFLOW GUARD: You're on ${stateResolution.branch}, but the workflow can't track that branch name.
Epic branches must read epic/<name> using lowercase letters, numbers and hyphens only — no capitals, spaces or underscores.
Action: Rename it (git branch -m epic/<new-name>), then /continue. The epic's records live under generated-docs/epics/<new-name>/, so rename that folder to match if it already exists.`;
  }

  // --- Branch C: not on an epic branch (or no project.md yet) ---
  if (!stateResolution || stateResolution.kind !== 'epic') {
    if (fs.existsSync(projectMdPath)) {
      return `WORKFLOW GUARD: No epic in flight. You're not on an epic/* branch.
Action: Redirect to /start to build the next epic, or /plan to plan one ahead. /continue reports where things stand without building.`;
    }
    return `WORKFLOW GUARD: No active workflow. No project.md and no epic in flight.
Action: Redirect to /start to begin the TDD workflow.`;
  }

  // --- Branch D: on an epic branch but state.json missing ---
  if (!stateResolution.exists) {
    return `WORKFLOW GUARD: On epic/${stateResolution.slug} but state.json is missing.
Action: Redirect to /start to (re-)initialise the epic state, or check out a different branch.`;
  }

  const state = readEpicState(root, stateResolution);
  if (!state) {
    // state.json is present (exists = true) but unreadable — corrupt or invalid
    // JSON. Surface it rather than failing open: a silent exit 0 would let
    // untracked dev work proceed on an active epic with no workflow guidance.
    // `stateResolution.path` is the resolver's own repo-relative path — don't rebuild it here.
    return `WORKFLOW GUARD: On epic/${stateResolution.slug} but state.json is present and unreadable (corrupt or invalid JSON).
Action: Inspect and repair ${stateResolution.path} before continuing — do not start untracked work.`;
  }

  const slug = stateResolution.slug;
  const phase = state.phase;
  const epicName = (state.epic && state.epic.name) || slug;

  if (phase === 'COMPLETE-ON-BRANCH') {
    return `WORKFLOW GUARD: Epic ${slug} is complete on branch. PR/merge is pending.
Action: Redirect to /continue to finish the PR + merge, or merge the PR manually.`;
  }
  if (phase === 'COMPLETE') {
    return `WORKFLOW GUARD: Epic ${slug} already complete and merged. You may be on a stale branch.
Action: git checkout main, then /start to build the next epic (or /plan to plan one ahead).`;
  }
  if (phase === 'READY-TO-BUILD') {
    return `WORKFLOW GUARD: Epic ${slug} (${epicName}) is planned and parked at READY-TO-BUILD — not building yet.
Action: Redirect to /start (or /continue) to build it now. To plan a different epic in parallel, use /plan in a separate workspace.`;
  }

  // A halt leaves no story in-progress, so report the halted story rather than
  // "N/A" — /continue's job on resume is to re-surface it, not to move on.
  const { inProgress, halted } = storySummary(state);
  const storyNumber = inProgress ?? halted;
  const haltNote = halted && !inProgress ? ' (HALTED — re-surface the halt)' : '';
  return `WORKFLOW GUARD: Active epic detected.
Phase: ${phase} | Epic: ${slug} (${epicName}) | Story: ${storyNumber || 'N/A'}${haltNote}
Action: Redirect to /continue to resume the epic-branch workflow.`;
}

function main() {
  const root = projectRoot();
  // Lazy: the dev-repo / uninitialised / legacy branches return before this runs,
  // so those prompts never pay for the git lookup.
  emitContext('UserPromptSubmit', buildGuardMessage(root, () => getStateResolution(root)));
}

if (require.main === module) {
  runHook(main); // fail open rather than crash the prompt
}

module.exports = { buildGuardMessage, DEV_REPO_MESSAGE };
