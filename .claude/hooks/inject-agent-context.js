#!/usr/bin/env node
/**
 * inject-agent-context.js
 *
 * SubagentStart hook: reinforces workflow state in subagent sessions.
 * Fires when any BUILD/PLAN/INTAKE agent starts (see settings.json matcher for
 * the canonical list).
 *
 * Injects: epic slug, phase, current story (~5-10 lines).
 * Lightweight — just state coordinates so the subagent knows what to work on.
 *
 * Output: JSON with hookSpecificOutput.additionalContext
 * Fail-safe: exits 0 with no output when not on an active epic branch.
 *
 * Port of inject-agent-context.ps1 — see lib/workflow-state.js for why.
 */
'use strict';

const {
  projectRoot,
  activeEpic,
  storySummary,
  resolveStoryAndTestFiles,
  emitContext,
  runHook,
  EPICS_DIR,
  PROJECT_MD_PATH,
} = require('./lib/workflow-state');

function buildContext(root, resolution, state) {
  const files = resolveStoryAndTestFiles(root, state, resolution.slug);
  const { inProgress, halted } = storySummary(state);
  // Halted counts as current: the subagent needs the story the halt stopped on.
  const storyNumber = inProgress ?? halted;
  const epicName = (state.epic && state.epic.name) || resolution.slug;

  const lines = [
    '## Workflow State',
    `- Branch: ${resolution.branch}`,
    `- Epic: ${resolution.slug} (${epicName})`,
    `- Phase: ${state.phase}`,
    `- Story: ${storyNumber ? `${storyNumber}${halted && !inProgress ? ' (HALTED)' : ''}` : 'N/A (epic-level phase)'}`,
    `- Project facts: ${PROJECT_MD_PATH}`,
    `- Epic brief: ${EPICS_DIR}/${resolution.slug}/brief.md`,
  ];
  if (files.storyFile) lines.push(`- Story file: ${files.storyFile}`);
  if (files.testFile) lines.push(`- Test file: ${files.testFile}`);
  return lines.join('\n');
}

function main() {
  const root = projectRoot();
  const active = activeEpic(root);
  if (!active) process.exit(0);

  emitContext('SubagentStart', buildContext(root, active.resolution, active.state));
}

if (require.main === module) {
  runHook(main);
}

module.exports = { buildContext };
