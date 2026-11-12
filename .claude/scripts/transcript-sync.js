#!/usr/bin/env node
'use strict';
/**
 * transcript-sync.js
 *
 * CLI over transcript-sync-core.js:
 *
 *   --catch-up [--notice-session <id>]
 *                         upload everything new for this project. Spawned
 *                         detached by the Stop hook; without a session that
 *                         showed the notice here, it binds no new files and
 *                         only finishes bound ones.
 *   --status [--json]     what has been collected. Read-only.
 *   --init-project        mint transcript-collection.json if it is absent.
 *   --root <dir>          the project root; defaults to project-root.js, never
 *                         the cwd a detached child inherits.
 *
 * Always exits 0. Failures go to `~/.stadium-builder/sync.log` and show in
 * `--status`.
 */

const { getProjectRoot } = require('./lib/project-root');
const { createCore } = require('./lib/transcript-sync-core');

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const value = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
};

const USAGE =
  'usage: node .claude/scripts/transcript-sync.js ' +
  '[--catch-up [--notice-session <id>] | --status [--json] | --init-project]';

async function main() {
  const core = createCore();
  const root = value('--root') || getProjectRoot();

  if (has('--status')) {
    if (has('--json')) {
      process.stdout.write(JSON.stringify(core.status({ root }), null, 2) + '\n');
    } else {
      // Empty when collection is off: print nothing, not a bare newline.
      const line = core.statusLine({ root });
      if (line) process.stdout.write(line + '\n');
    }
    return;
  }

  if (has('--init-project')) {
    const result = core.initProject(root);
    if (result.ok && result.created) {
      process.stdout.write(`Created transcript-collection.json (project ${result.collection.projectId}).\n`);
    } else if (result.ok) {
      process.stdout.write('transcript-collection.json already exists.\n');
    } else {
      process.stdout.write(`Nothing to do (${result.reason}).\n`);
    }
    return;
  }

  if (has('--catch-up')) {
    await core.catchUp({ root, noticeSession: value('--notice-session') });
    return;
  }

  process.stdout.write(USAGE + '\n');
}

main().catch((error) => {
  // Logged by code only: the message can carry a path.
  try {
    const core = createCore();
    core.log('cli_failed', { code: core.failureCode(error) });
  } catch {
    /* nothing left to do */
  }
});
