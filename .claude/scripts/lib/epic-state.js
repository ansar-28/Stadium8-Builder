'use strict';
/**
 * lib/epic-state.js — schema *data* for per-epic state.json.
 *
 * This is intentionally minimal. The workflow's executor is Claude (see
 * memory: feedback-llm-executor-mindset). Phase transitions, story status
 * updates, and validation are described in agent prompts and command docs —
 * Claude reads the rules and applies them via Edit/Write directly.
 *
 * This file exists only to give the rules a single canonical *data* home that
 * code with no LLM in the loop (hooks, dashboard, CI) can reference:
 *
 *   - Phase enum  + transition graph
 *   - Story status enum
 *   - E2E status enum
 *   - Halt stage enum
 *   - Default-state factory (used by `--init` only)
 *
 * Per-epic state.json shape (this module is the source of truth for it):
 *
 *   {
 *     schemaVersion: 1,
 *     epic: { epicId, slug, name, createdAt, dependsOn: [], introducesSharedSurface, unverifiedAssumptions: [], manualTestResults: [],
 *             parkedDesignUpdate, designFingerprint, designDecisions: [] },
 *     phase: PHASE,
 *     stories: { "<N>": { storyId, status, e2eStatus, startedAt, completedAt } },
 *     halt: null | { reason, stage, raisedAt, requiresProjectChange? },
 *     lastUpdated: <ISO8601>
 *   }
 *
 * epic.epicId and stories[N].storyId (UUIDs) are minted once at creation —
 * epicId here at --init, storyId when the approved stories are written at
 * PLAN (continue.md "On approval") — and never regenerated. They identify the
 * epic and story in the Stadium Builder build-metrics store, where a re-minted
 * id restarts that work's accumulated totals from zero under new rows. Slugs,
 * names and ordinals stay free to change; the ids never do — so every write to
 * an existing stories[N] entry updates fields in place rather than replacing
 * the entry, which would drop the id. In-flight epics that predate the fields
 * gain them via the backfill in continue.md Step 1; epics already at COMPLETE
 * are left alone, having no metrics history for an id to attach to.
 *
 * stories[N].startedAt / completedAt (ISO8601 | null) are stamped by the
 * orchestrator: startedAt when the story first goes in-progress (B1, never
 * overwritten on resume), completedAt at the story commit (B5). They exist so
 * reporting (the /build-report-* commands) can attribute time and cost per
 * story instead of per epic — no workflow logic reads them.
 *
 * epic.introducesSharedSurface (bool) and epic.unverifiedAssumptions (string[]) are
 * populated by the orchestrator at PLAN from the planner's output; defaulted at init.
 * epic.manualTestResults ([{ story, test, passed, comment }]) is the last pasted-back
 * manual-test check state, persisted at B7.1 so a post-fix re-display can carry over
 * ticks and re-verify only the affected tests; defaulted to [] at init.
 *
 * epic.parkedDesignUpdate (bool), epic.designFingerprint (string | null) and
 * epic.designDecisions ([{ outcome, line, supersedes }]) carry a design-update epic planned
 * ahead by /plan (Step 3c) across to the build that picks it up (continue.md READY-TO-BUILD
 * step 2). They are its only trace on main: the design *record* the developer builds from (the
 * digest) may not park there ahead of the screens built from it (epic-branch-concurrency §6.2),
 * though designDecisions[].line does carry a one-line description of the approved change.
 * READY-TO-BUILD skips the entire design-apply block when parkedDesignUpdate isn't true, so dropping
 * these in a migration loses the user's design source at merge. designDecisions feeds the
 * append-vs-strike rule owned by shared/approval-pattern.md; don't restate it here.
 * Defaulted at init (false / null / []); /plan overwrites them via Edit right after --init.
 * The name says the scope: only a *parked* design update sets it. A design epic built straight
 * through /start applies its design as it goes and never parks, so the flag stays false.
 *
 * Derived fields (NOT stored):
 *   - currentStory: the story with status === "in-progress" (or null)
 *   - cycleNumber: counted from commits/journal entries when needed
 *
 * summariseStories below is the one derivation of those story roll-ups. It lives
 * here because three consumers with no LLM in the loop need to agree on them: the
 * context hooks, the dashboard, and the build report. They previously each had
 * their own copy, which had already drifted — only the dashboard's understood
 * `halted`, so a halted story read as "no current story" in the hook-injected
 * coordinates and the orchestrator was told to resume BUILD instead of
 * re-surfacing the halt.
 */

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;

const EPIC_PHASES = Object.freeze([
  'PLAN',
  'READY-TO-BUILD',
  'BUILD',
  'EPIC-END',
  'MANUAL-TEST',
  'COMPLETE-ON-BRANCH',
  'COMPLETE'
]);

const STORY_STATUS_VALUES = Object.freeze(['pending', 'in-progress', 'complete', 'halted']);

// Epic-branch enum — narrower than the legacy set in lib/workflow-helpers.js.
// "deferred" is the default at story-commit time (Playwright runs at epic-end);
// "pending"/"running"/"escalated"/"user-skipped*"/"missing" are not used here.
const E2E_STATUS_VALUES = Object.freeze([
  'deferred',
  'passed',
  'passed-after-fix',
  'failed',
  'auto-skipped:non-routable',
  'auto-skipped:fixme'
]);

const HALT_STAGES = Object.freeze([
  'plan',
  'test-generator',
  'developer',
  'epic-end',
  'manual-test'
]);

// Valid phase transitions. PLAN branches by caller: → READY-TO-BUILD when `/plan`
// parks the epic ahead of time (the parallel plan-ahead path); → BUILD when
// `/start` plans and builds through in one pass. READY-TO-BUILD → BUILD when a
// parked epic is later picked up (`/start` or `/continue`). Re-entries
// (EPIC-END → BUILD, MANUAL-TEST → BUILD) cover the fix-cycle and
// manual-test-failure paths.
const VALID_TRANSITIONS = Object.freeze({
  'PLAN': ['READY-TO-BUILD', 'BUILD'],
  'READY-TO-BUILD': ['BUILD'],
  'BUILD': ['EPIC-END'],
  'EPIC-END': ['MANUAL-TEST', 'BUILD'],
  'MANUAL-TEST': ['COMPLETE-ON-BRANCH', 'BUILD'],
  'COMPLETE-ON-BRANCH': ['COMPLETE'],
  'COMPLETE': []
});

// Terminal phases: the epic is finished (COMPLETE-ON-BRANCH = done on its branch,
// merge pending; COMPLETE = the after-merge stamp on main). Derived from the enum
// so it can't drift if a phase is added or renamed.
const TERMINAL_PHASES = Object.freeze(new Set(['COMPLETE-ON-BRANCH', 'COMPLETE']));
const isTerminalPhase = (phase) => TERMINAL_PHASES.has(phase);

const EMPTY_STORY_SUMMARY = Object.freeze({ total: 0, complete: 0, inProgress: null, halted: null });

/**
 * Story roll-up for a state.json `stories` map: { total, complete, inProgress, halted }.
 *
 * `inProgress` / `halted` are the raw story KEYS, returned as-is rather than
 * parseInt-ed: keys are numeric by convention, but a non-numeric key must not
 * crash a hook. Every predicate guards `story &&` first, so a null entry in a
 * partially written state.json is skipped rather than throwing.
 */
function summariseStories(stories) {
  if (!stories || typeof stories !== 'object') return EMPTY_STORY_SUMMARY;
  const entries = Object.entries(stories);
  const inProgress = entries.find(([, story]) => story && story.status === 'in-progress');
  const halted = entries.find(([, story]) => story && story.status === 'halted');
  return {
    total: entries.length,
    complete: entries.filter(([, story]) => story && story.status === 'complete').length,
    inProgress: inProgress ? inProgress[0] : null,
    halted: halted ? halted[0] : null
  };
}

/**
 * The story the epic is standing on: the in-progress one, else a halted one.
 * A halt leaves no story in-progress, and reporting "none" there hid the halt
 * from the orchestrator — phase-context/build.md requires it be re-surfaced.
 * Returns null at epic-level phases, where no story is current.
 */
function currentStory(stories) {
  const { inProgress, halted } = summariseStories(stories);
  return inProgress ?? halted;
}

function defaultEpicState({ slug, name, dependsOn = [] } = {}) {
  if (!slug) throw new Error('defaultEpicState: slug is required');
  if (!name) throw new Error('defaultEpicState: name is required');
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    epic: {
      epicId: crypto.randomUUID(), slug, name, createdAt: now, dependsOn: [...dependsOn],
      introducesSharedSurface: false, unverifiedAssumptions: [], manualTestResults: [],
      parkedDesignUpdate: false, designFingerprint: null, designDecisions: []
    },
    phase: 'PLAN',
    stories: {},
    halt: null,
    lastUpdated: now
  };
}

module.exports = {
  SCHEMA_VERSION,
  EPIC_PHASES,
  STORY_STATUS_VALUES,
  E2E_STATUS_VALUES,
  HALT_STAGES,
  VALID_TRANSITIONS,
  TERMINAL_PHASES,
  isTerminalPhase,
  EMPTY_STORY_SUMMARY,
  summariseStories,
  currentStory,
  defaultEpicState
};
