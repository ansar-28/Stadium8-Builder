#!/usr/bin/env node
/**
 * resolve-state-path.js
 *
 * Single source of truth for "where is the active workflow state file?" under
 * the epic-branch workflow. Hooks (workflow-guard.js, inject-phase-context.js,
 * inject-agent-context.js) and scripts use this instead of CWD-relative or
 * hardcoded paths. The hooks require resolveStatePath as a module rather than
 * spawning this CLI, so they add no process start-up per invocation.
 *
 * Resolution rules:
 *   1. Determine current branch via `git symbolic-ref --short HEAD`.
 *   2. If branch matches `epic/<slug>` → `generated-docs/epics/<slug>/state.json`
 *      (kind: "epic"; the file may not yet exist on a freshly-created branch).
 *   3. Else → path: null, kind: "none".
 *
 * Legacy `generated-docs/context/workflow-state.json` is NOT a valid state
 * source under this workflow. Projects with legacy state must run
 * `/migrate-legacy` first.
 *
 * Usage:
 *   node .claude/scripts/resolve-state-path.js              # JSON to stdout
 *   node .claude/scripts/resolve-state-path.js --root <dir> # operate on <dir> instead of CWD
 *   node .claude/scripts/resolve-state-path.js --branch <name>  # override git lookup (used by tests)
 *
 * Output (JSON):
 *   {
 *     "status": "ok" | "error",
 *     "kind":   "epic" | "none",
 *     "branch": "epic/dashboard-overview" | "main" | null,
 *     "slug":   "dashboard-overview" | null,
 *     "path":   "generated-docs/epics/dashboard-overview/state.json" | null,
 *     "absolutePath": "<root>/generated-docs/epics/.../state.json" | null,
 *     "exists": true | false,
 *     "error":  "<message>"   // only when status === "error"
 *   }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getProjectRoot } = require('./lib/project-root');

const EPIC_BRANCH_PREFIX = 'epic/';
// The generated-docs root — the single home for the workflow's on-disk layout.
// EPICS_DIR derives from it, and the dashboard scripts import it as the base
// their in-page links resolve relative to, so the root is written down once.
const GENERATED_DOCS_DIR = 'generated-docs';
const EPICS_DIR = `${GENERATED_DOCS_DIR}/epics`;
// Every generated report page and its data file lives here — one gitignored folder, so
// generated-docs/ itself stays project content only. All four /build-report-* commands
// derive their output paths from this constant rather than spelling the folder out.
const REPORTS_DIR = `${GENERATED_DOCS_DIR}/reports`;
const PROJECT_MD_PATH = `${GENERATED_DOCS_DIR}/project.md`; // project-level facts marker
const LEGACY_STATE_PATH = `${GENERATED_DOCS_DIR}/context/workflow-state.json`; // pre-epic-branch monolithic state

// Consume the value following a value-taking flag, erroring (rather than crashing on
// path.resolve(undefined) or silently binding the next flag as the value) when it's missing.
// Shared by the sibling state CLIs (epic-state.js, mark-epic-complete.js, migrate-legacy-state.js)
// so the guard stays in one place rather than copy-pasted per script.
function requireValue(argv, valueIndex, flag) {
  const value = argv[valueIndex];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = { root: getProjectRoot(), branch: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') { args.root = path.resolve(requireValue(argv, ++i, '--root')); }
    else if (arg === '--branch') { args.branch = requireValue(argv, ++i, '--branch'); }
    else if (arg === '--help' || arg === '-h') { args.help = true; }
    else { throw new Error(`Unknown argument: ${arg}`); }
  }
  return args;
}

function detectBranch(root) {
  try {
    const branchName = execFileSync('git', ['-C', root, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return branchName.trim() || null;
  } catch {
    return null;
  }
}

function isValidEpicSlug(slug) {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

function resolveStatePath({ root, branch }) {
  const effectiveBranch = branch ?? detectBranch(root);

  if (effectiveBranch && effectiveBranch.startsWith(EPIC_BRANCH_PREFIX)) {
    const slug = effectiveBranch.slice(EPIC_BRANCH_PREFIX.length);
    if (!isValidEpicSlug(slug)) {
      return {
        status: 'error',
        error: `Invalid epic slug in branch name "${effectiveBranch}" — expected kebab-case after "epic/"`,
        kind: null,
        branch: effectiveBranch,
        slug: null,
        path: null,
        absolutePath: null,
        exists: false
      };
    }
    const relativePath = `${EPICS_DIR}/${slug}/state.json`;
    const absolutePath = path.join(root, relativePath);
    return {
      status: 'ok',
      kind: 'epic',
      branch: effectiveBranch,
      slug,
      path: relativePath,
      absolutePath,
      exists: fs.existsSync(absolutePath)
    };
  }

  return {
    status: 'ok',
    kind: 'none',
    branch: effectiveBranch,
    slug: null,
    path: null,
    absolutePath: null,
    exists: false
  };
}

function printHelp() {
  console.log('Usage: node .claude/scripts/resolve-state-path.js [--root <dir>] [--branch <name>]');
  console.log('');
  console.log('Resolves the active workflow state.json path for the current branch.');
  console.log('Returns JSON on stdout. kind=epic when on an epic/* branch, kind=none otherwise.');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error('Run with --help for usage.');
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = resolveStatePath({ root: args.root, branch: args.branch });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.status === 'ok' ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveStatePath,
  detectBranch,
  isValidEpicSlug,
  requireValue,
  EPIC_BRANCH_PREFIX,
  GENERATED_DOCS_DIR,
  EPICS_DIR,
  REPORTS_DIR,
  PROJECT_MD_PATH,
  LEGACY_STATE_PATH
};
