#!/usr/bin/env node
/**
 * workflow-state.js
 *
 * Shared helpers for workflow-guard.js, inject-phase-context.js and
 * inject-agent-context.js under the epic-branch workflow, and for
 * transcript-sync-hook.js.
 *
 * Port of the former lib/workflow-state.ps1. PowerShell (`powershell.exe`, plus
 * `-ExecutionPolicy Bypass`) exists only on Windows, which made the three hooks
 * that depended on it — including the workflow guard itself — silently no-op on
 * macOS and Linux. Node is already the runtime for the other two hooks and for
 * every .claude/scripts/* CLI, so it needs no new dependency.
 *
 * State path resolution comes from .claude/scripts/resolve-state-path.js, which
 * is required as a MODULE here rather than spawned as a subprocess (the .ps1
 * version shelled out to `node resolve-state-path.js` and parsed its stdout).
 * That removes a Node cold-start from every hook invocation — the latency the
 * old hooks needed a generous 10s timeout to absorb.
 *
 * Every helper is fail-safe: it returns null / an empty result rather than
 * throwing, mirroring the `$ErrorActionPreference = 'SilentlyContinue'` contract
 * of the PowerShell original. Hooks must never crash the harness.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveStatePath,
  EPICS_DIR,
  PROJECT_MD_PATH,
  LEGACY_STATE_PATH,
} = require('../../scripts/resolve-state-path');
const { getProjectRoot } = require('../../scripts/lib/project-root');
const { summariseStories, currentStory, EPIC_PHASES } = require('../../scripts/lib/epic-state');

/**
 * Repo root, independent of CWD. Honours CLAUDE_PROJECT_DIR when the harness
 * sets it (matching enforce-generated-doc-names.js), else walks up to the
 * nearest `.claude/`/`.git/` marker via lib/project-root.js — the same
 * marker-walk Get-ProjectRoot did from $PSScriptRoot.
 */
function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || getProjectRoot();
}

/**
 * Resolves the active state file for the current branch.
 * Returns { status, kind, branch, slug, path, absolutePath, exists } or null when
 * the resolver throws.
 *
 * `status: 'error'` is passed through rather than collapsed to null: it means the
 * resolver saw an `epic/*` branch and rejected its NAME (slugs are lowercase,
 * digits and hyphens). Reporting that as "no resolution" made the guard tell a
 * user standing on `epic/My_Feature` that they weren't on an epic branch, and send
 * them to /start to create a second one. `kind` stays null on that path, so
 * callers that key off `kind === 'epic'` are unaffected.
 */
function getStateResolution(root) {
  try {
    const resolved = resolveStatePath({ root, branch: null });
    if (!resolved) return null;
    return {
      status: resolved.status,
      error: resolved.error || null,
      kind: resolved.kind,
      branch: resolved.branch,
      slug: resolved.slug,
      path: resolved.path,
      absolutePath: resolved.absolutePath,
      exists: resolved.exists,
    };
  } catch {
    return null;
  }
}

/**
 * Reads and parses the per-epic state.json on the current epic/* branch.
 * Returns null when not on an epic branch, when state.json is missing, or on
 * parse error. Callers that already hold a resolution should pass it to avoid a
 * second git spawn.
 */
function readEpicState(root, resolution) {
  const stateResolution = resolution || getStateResolution(root);
  if (!stateResolution || stateResolution.kind !== 'epic' || !stateResolution.exists) return null;
  try {
    // Strip a leading UTF-8 BOM before parsing. Windows editors and PowerShell
    // redirects write one, JSON.parse rejects it, and the guard's corrupt-state
    // branch fails closed — so a BOM on a perfectly valid state.json would block
    // every prompt with a "repair this file" message that a repair in PowerShell
    // reproduces. `Get-Content -Raw | ConvertFrom-Json` tolerated it; so does
    // apply-template.js readJson. Compared by code point, so the character is
    // visible here rather than an invisible literal in a regex.
    const text = fs.readFileSync(stateResolution.absolutePath, 'utf8');
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
}

/** Absolute path -> repo-relative, forward-slashed (stable across platforms). */
function toRelativePath(absolutePath, root) {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

/**
 * Active = on an epic/* branch with state.json present, at a real phase that
 * isn't COMPLETE.
 *
 * COMPLETE-ON-BRANCH counts as ACTIVE on purpose — the merge is still
 * outstanding and phase-context/complete-on-branch.md exists to guide it. That's
 * why this doesn't reuse isTerminalPhase, which answers the dashboard's
 * different question ("is the epic finished?").
 *
 * A phase outside EPIC_PHASES is treated as inactive: a typo or a corrupted
 * value would otherwise inject a context block announcing a phase that doesn't
 * exist. The guard still reports it, so the user isn't left in the dark.
 */
function isActiveWorkflow(state) {
  if (!state || !state.phase) return false;
  if (!EPIC_PHASES.includes(state.phase)) return false;
  return state.phase !== 'COMPLETE';
}

/**
 * Story roll-up for the coordinates block: { total, complete, inProgress, halted }.
 * Adapts a whole `state` to the canonical derivation in lib/epic-state.js, which
 * the dashboard and the build report also use — the counts and the current-story
 * rule must not differ between what the user sees and what a resumed session is
 * told.
 */
function storySummary(state) {
  return summariseStories(state && state.stories);
}

/**
 * First file in `dir` whose name starts with `prefix` (and ends with `suffix`,
 * when given), as a repo-relative path — or null.
 *
 * Literal prefix matching, not a regex: story keys are caller data and a key
 * containing a regex metacharacter must not change the match semantics. Results
 * are sorted so a directory holding two matches resolves deterministically
 * rather than depending on readdir order.
 */
function findFirstFile(dir, prefix, suffix, root) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // directory missing — expected before PLAN creates it
  }
  const match = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(prefix) && (!suffix || name.endsWith(suffix)))
    .sort()[0];
  return match ? toRelativePath(path.join(dir, match), root) : null;
}

/**
 * Returns { storyFile, testFile } (repo-relative or null) for the in-progress
 * story on the active epic branch. Story files live at
 * generated-docs/epics/<slug>/stories/story-<N>-*.md; integration test files at
 * web/src/__tests__/integration/epic-<slug>-story-<N>-* (test-generator.md §47).
 */
function resolveStoryAndTestFiles(root, state, slug) {
  const result = { storyFile: null, testFile: null };
  if (!state || !slug) return result;

  // A halted story still has files to point at — the halt has to be re-surfaced
  // against the story it stopped on, so currentStory covers both.
  const storyNumber = currentStory(state && state.stories);
  if (!storyNumber) return result;

  result.storyFile = findFirstFile(
    path.join(root, ...EPICS_DIR.split('/'), slug, 'stories'),
    `story-${storyNumber}-`,
    '.md',
    root
  );
  result.testFile = findFirstFile(
    path.join(root, 'web', 'src', '__tests__', 'integration'),
    `epic-${slug}-story-${storyNumber}-`,
    null,
    root
  );

  return result;
}

/**
 * Emits a hook's additionalContext payload and exits 0.
 * Shape matches what the .ps1 hooks produced via ConvertTo-Json.
 *
 * Sets exitCode and lets Node exit on its own rather than calling process.exit():
 * stdout to a PIPE — which is how the harness reads a hook — is asynchronous on
 * macOS and Linux, and process.exit() is documented to abandon a pending write.
 * The payloads run 4-6 KB, so a truncated one would cost the whole
 * post-compaction recovery block at the moment the session has just lost its
 * context. Nothing here holds the event loop open, so the process still exits
 * immediately after the write drains.
 */
function emitContext(hookEventName, additionalContext) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }, null, 2) + '\n'
  );
  process.exitCode = 0;
}

/**
 * Resolves the coordinates the two context injectors both need, or null when
 * there is nothing to inject — off an epic branch, before state.json exists, or
 * once the epic is COMPLETE. Shared so the two hooks cannot drift on what
 * "active" means.
 */
function activeEpic(root) {
  const resolution = getStateResolution(root);
  if (!resolution || resolution.kind !== 'epic' || !resolution.exists) return null;
  const state = readEpicState(root, resolution);
  if (!isActiveWorkflow(state)) return null;
  return { resolution, state };
}

/**
 * Runs a hook body, swallowing anything it throws. A hook must never crash the
 * harness: an exception on UserPromptSubmit would disrupt the prompt, and on
 * SessionStart/SubagentStart it would surface as noise the user cannot act on.
 *
 * The exit abandons a pending stdout write, so a throw after an emit loses the
 * payload: emit last, or catch without exiting (as transcript-sync-hook.js does).
 */
function runHook(hookBody) {
  try {
    hookBody();
  } catch {
    process.exit(0);
  }
}

module.exports = {
  projectRoot,
  getStateResolution,
  readEpicState,
  toRelativePath,
  isActiveWorkflow,
  storySummary,
  findFirstFile,
  resolveStoryAndTestFiles,
  emitContext,
  activeEpic,
  runHook,
  EPICS_DIR,
  PROJECT_MD_PATH,
  LEGACY_STATE_PATH,
};
