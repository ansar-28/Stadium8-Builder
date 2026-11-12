#!/usr/bin/env node
/**
 * design-fingerprint.js
 * Fingerprints the user's design source so a parked design-update epic can tell whether
 * the design moved between `/plan` (which plans against it) and BUILD (which builds from it).
 *
 * Usage:
 *   node .claude/scripts/design-fingerprint.js
 *   node .claude/scripts/design-fingerprint.js --compare <fingerprint>
 *
 * Output (stdout, JSON):
 *   { "status": "ok", "fingerprint": "<tree hash>" }
 *   { "status": "ok", "fingerprint": "...", "match": true|false, "changed": [{ "status": "M", "path": "..." }] }
 *   { "status": "error", "message": "..." }
 *
 * `changed` is the per-file list on a mismatch -- the only file listing a caller needs, and the
 * one READY-TO-BUILD uses to tell the user what actually moved. The full inventory is deliberately
 * not emitted: it is hundreds of lines for a real design export and nothing reads it.
 *
 * Why a script and not three bash lines: the comparison only means anything if both call sites
 * (`/plan` Step 5.2 and READY-TO-BUILD step 2b) hash the same thing the same way. Two prose
 * promises become structural here — GIT_INDEX_FILE is bound in the child env, so it cannot be
 * dropped, lower-cased, or split off by a newline (each of which silently clears the real
 * `.git/index`); and the throwaway index is mkdtemp'd outside the repo, so it always exists.
 *
 * What is NOT structural: which project gets hashed. getProjectRoot() anchors to THIS FILE's
 * location, not the CWD — so it resolves the session root only when the session root's own copy
 * is the one invoked. A plan worktree carries its own `.claude/scripts/`, and running that copy
 * fingerprints the worktree's stale design instead. `/plan` Step 5.2 therefore has to say "run the
 * session root's copy", and that remains a prose promise.
 *
 * Scope note: the hash covers all of `documentation/`, which is also where OpenAPI specs and
 * sample datasets live, so an edit to those moves the fingerprint too. That is deliberately the
 * conservative direction — it never misses a design edit — and `changed` is reported so the caller
 * can tell the user what actually moved instead of asserting it was the design.
 * `.gitignore`d files are invisible to `git add`, so ignored design assets are not covered.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getProjectRoot } = require('./lib/project-root');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function fail(message) {
  process.stdout.write(JSON.stringify({ status: 'error', message }, null, 2) + '\n');
  process.exit(1);
}

/**
 * Run `git -C <root> <args>` with the throwaway index bound in the child env.
 *
 * Not lib/git.js's tryGit: that one swallows every failure into null, which is right for the
 * collectors (missing data renders as "unknown") and wrong here, where a failed read-tree must
 * surface as an error rather than a fingerprint of "null" that mismatches on every build.
 */
function git(root, indexFile, args) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_INDEX_FILE: indexFile }
  }).trim();
}

function parseArgs(argv) {
  const options = { compare: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--compare') {
      options.compare = argv[++i];
      if (!options.compare) fail('--compare needs a fingerprint value');
    } else {
      fail(`Unknown argument: ${argv[i]}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const root = getProjectRoot();

// The throwaway index: mkdtemp guarantees the directory exists and is outside the repo.
let scratchDir;
try {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-fingerprint-'));
} catch (err) {
  fail(`Could not create a scratch directory for the throwaway index: ${err.message}`);
}
const indexFile = path.join(scratchDir, 'design.idx');

let result;
try {
  const hasDocumentation = fs.existsSync(path.join(root, 'documentation'));

  let fingerprint;
  if (!hasDocumentation) {
    // No design folder at all — the empty tree, which is a stable, comparable value.
    fingerprint = EMPTY_TREE;
  } else {
    git(root, indexFile, ['read-tree', '--empty']);
    git(root, indexFile, ['add', '-A', '--', 'documentation/']);
    fingerprint = git(root, indexFile, ['write-tree']);
  }

  result = { status: 'ok', fingerprint };

  if (options.compare) {
    result.match = options.compare === fingerprint;
    if (!result.match) {
      // Both are real tree objects in this repo, so they can be diffed — unless the older one
      // was pruned by `git gc` (unreachable objects, 2-week default). Degrade to the bare
      // verdict rather than failing: the hash comparison above is what the decision rests on.
      let nameStatus = null;
      try {
        nameStatus = git(root, indexFile, [
          'diff', '--name-status', '--no-renames', options.compare, fingerprint
        ]);
      } catch {
        result.changedUnavailable =
          'The design as planned is no longer in the repository object store, so the per-file list is unavailable.';
      }
      if (nameStatus !== null) {
        result.changed = nameStatus
          ? nameStatus.split('\n').map(line => {
              const [status, ...pathParts] = line.split('\t');
              return { status, path: pathParts.join('\t') };
            })
          : [];
      }
    }
  }
} catch (err) {
  const detail = (err.stderr || err.message || '').toString().trim();
  fail(`Could not fingerprint documentation/: ${detail}`);
} finally {
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
