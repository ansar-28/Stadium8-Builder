#!/usr/bin/env node
/**
 * PreToolUse hook that blocks Write/Edit/MultiEdit on generated documents
 * whose filenames don't match the conventions in
 * .claude/shared/generated-doc-conventions.json.
 *
 * Classification (see schema.matching.description):
 *   OK        — filename matches a convention's filenamePattern (and its dirGlob).
 *   DRIFT     — filename matches a convention's badPattern but NOT its filenamePattern.
 *   UNGOVERNED — neither pattern matches in any convention; not this hook's concern.
 *
 * Exit codes:
 *   0 without output — fall through to normal permission system (allow).
 *   2 with stderr message — block the tool call.
 *
 * Grandfather clause: existing files on disk are allowed regardless of name —
 * this hook only stops NEW drift, not edits to legacy files. The repo-wide
 * validator (validate-generated-doc-names.js) still flags them.
 *
 * Location: .claude/hooks/enforce-generated-doc-names.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('../scripts/lib/project-root');
const { toPosix, loadConventions, compileConventions, classify } = require('../scripts/lib/doc-conventions');

const GATED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

function fallThrough() { process.exit(0); }
function block(message) { process.stderr.write(message + '\n'); process.exit(2); }

// --- Read stdin ------------------------------------------------------------
let inputJson;
try {
  inputJson = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  fallThrough();
}

if (!GATED_TOOLS.has(inputJson.tool_name)) fallThrough();

const filePath = inputJson.tool_input?.file_path;
if (!filePath) fallThrough();

const projectRoot = process.env.CLAUDE_PROJECT_DIR || getProjectRoot();
const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
const relativePath = toPosix(path.relative(projectRoot, absolutePath));

// Canonical artifact dirs (generated-docs/, .claude/) live ONLY at the repo
// root. A write nesting one under web/ is the CWD-drift bug — a command ran
// from the web/ directory. Block it regardless of CWD, ahead of the name and
// grandfather checks, since that path must never exist even if a stray already
// does. (Defense-in-depth: the scripts themselves now anchor to the repo root
// via lib/project-root.js; this catches Write/Edit tool calls too.)
if (/^web\/(generated-docs|\.claude)\//.test(relativePath)) {
  block(
    [
      'Blocked by write-location guard: .claude/hooks/enforce-generated-doc-names.js',
      '',
      `  Attempted write: ${relativePath}`,
      '',
      'Canonical artifact directories (generated-docs/, .claude/) live at the repo',
      'root, never under web/ — this usually means a command ran from the web/ directory.',
      `Write to the repo-root path instead: ${relativePath.replace(/^web\//, '')}`,
    ].join('\n')
  );
}

if (!relativePath.startsWith('generated-docs/') && !relativePath.startsWith('web/e2e/')) {
  fallThrough();
}

// Grandfather: existing files bypass enforcement.
if (fs.existsSync(absolutePath)) fallThrough();

// --- Classify against the schema -------------------------------------------
// Fail open on an unreadable schema, and drop any convention that won't compile: an
// uncaught throw in a PreToolUse hook means a stack trace on every Write/Edit. Broken
// conventions are named by the audit (node .claude/scripts/validate-generated-doc-names.js),
// which exits 2 — run it after editing the schema, since nothing runs it for you.
const { conventions, error } = loadConventions(projectRoot);
if (error) fallThrough();

const { compiled } = compileConventions(conventions);
const { status, drift: driftMatches } = classify(relativePath, compiled);

// `ok` and `ungoverned` both allow — this hook only stops names it can name a rule for.
if (status !== 'drift') fallThrough();

// --- Block with guidance ---------------------------------------------------
const lines = [
  'Blocked by filename-convention guard: .claude/hooks/enforce-generated-doc-names.js',
  '',
  `  Attempted write: ${relativePath}`,
  '',
  'This filename matches a known drift pattern. Expected shape:',
  '',
];
for (const convention of driftMatches) {
  lines.push(`  [${convention.id}]`);
  lines.push(`    Correct pattern: ${convention.filenamePattern}`);
  lines.push(`    Good:  ${convention.example}`);
  lines.push(`    Bad:   ${convention.counterexample}`);
  lines.push(`    Why:   ${convention.rationale}`);
  lines.push('');
}
lines.push(
  'Retry with a filename that matches the correct pattern above.',
  'Full rule table: .claude/shared/naming-conventions.md'
);

block(lines.join('\n'));
