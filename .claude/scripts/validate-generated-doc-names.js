#!/usr/bin/env node
/**
 * Repo-wide validator for AI-generated-document filenames.
 *
 * Walks generated-docs/ and web/e2e/, matches each file against the
 * conventions in .claude/shared/generated-doc-conventions.json.
 *
 * Classification (see schema.matching.description):
 *   OK        — filename matches a convention's filenamePattern in its dirGlob.
 *   DRIFT     — filename matches a convention's badPattern but NOT its filenamePattern.
 *   UNGOVERNED — neither; not a governed doc type.
 *
 * Usage:
 *   node .claude/scripts/validate-generated-doc-names.js           # --check (default)
 *   node .claude/scripts/validate-generated-doc-names.js --verbose
 *   node .claude/scripts/validate-generated-doc-names.js --format=json
 *
 * Exit codes:
 *   0 — no drift.
 *   1 — one or more files are DRIFT.
 *   2 — schema file missing or malformed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('./lib/project-root');
const { toPosix, loadConventions, compileConventions, classify } = require('./lib/doc-conventions');

const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose');
const jsonOutput = args.has('--format=json');

const projectRoot = process.env.CLAUDE_PROJECT_DIR || getProjectRoot();

// --- Load and compile the schema, once, up front ---------------------------
// Exit 2 on a convention that won't compile rather than skipping it: a convention whose
// dirGlob uses unsupported syntax matches no directory at all, so it enforces nothing
// while looking enforced — the failure mode that hid the epic-scoped rules for six
// releases. This is the only place that reports a broken rule, so it says which one.
const { file: schemaFile, conventions, error } = loadConventions(projectRoot);
if (error) {
  process.stderr.write(`Cannot read schema at ${schemaFile}: ${error}\n`);
  process.exit(2);
}
if (conventions.length === 0) {
  process.stderr.write(`Schema has no conventions to check.\n`);
  process.exit(2);
}

const { compiled, errors } = compileConventions(conventions);
if (errors.length > 0) {
  for (const { id, problem } of errors) {
    process.stderr.write(`Convention "${id}" in ${schemaFile}: ${problem}\n`);
  }
  process.exit(2);
}

// --- Walk governed subtrees ------------------------------------------------
const GOVERNED_ROOTS = ['generated-docs', 'web/e2e'];

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

const files = [];
for (const root of GOVERNED_ROOTS) {
  const absoluteRoot = path.join(projectRoot, root);
  if (!fs.existsSync(absoluteRoot)) continue;
  for (const filePath of walk(absoluteRoot)) files.push(filePath);
}

// --- Classify each file ----------------------------------------------------
const results = [];
for (const absolutePath of files) {
  const relativePath = toPosix(path.relative(projectRoot, absolutePath));
  const { status, convention, drift } = classify(relativePath, compiled);

  if (status === 'ok') {
    results.push({ path: relativePath, status, convention: convention.id });
  } else if (status === 'drift') {
    results.push({
      path: relativePath,
      status,
      expectedConventions: drift.map(driftConvention => ({
        id: driftConvention.id,
        filenamePattern: driftConvention.filenamePattern,
        example: driftConvention.example,
        counterexample: driftConvention.counterexample,
        rationale: driftConvention.rationale,
      })),
    });
  } else {
    results.push({ path: relativePath, status });
  }
}

// --- Report ----------------------------------------------------------------
const drift = results.filter(result => result.status === 'drift');
const ok = results.filter(result => result.status === 'ok');
const ungoverned = results.filter(result => result.status === 'ungoverned');

if (jsonOutput) {
  process.stdout.write(JSON.stringify({
    status: drift.length === 0 ? 'ok' : 'drift',
    counts: { ok: ok.length, drift: drift.length, ungoverned: ungoverned.length },
    drift,
    ok: verbose ? ok : undefined,
    ungoverned: verbose ? ungoverned : undefined,
  }, null, 2) + '\n');
  process.exit(drift.length === 0 ? 0 : 1);
}

if (drift.length === 0) {
  process.stdout.write(`Clean: ${ok.length} governed file(s) match their conventions.`);
  if (ungoverned.length) process.stdout.write(` (${ungoverned.length} ungoverned.)`);
  process.stdout.write('\n');
  if (verbose) {
    if (ok.length) {
      process.stdout.write('\nGoverned files:\n');
      for (const result of ok) process.stdout.write(`  [${result.convention}] ${result.path}\n`);
    }
    if (ungoverned.length) {
      process.stdout.write('\nUngoverned files (no dirGlob + pattern match; not a governed doc type):\n');
      for (const result of ungoverned) process.stdout.write(`  ${result.path}\n`);
    }
  }
  process.exit(0);
}

process.stdout.write(`Drift detected: ${drift.length} file(s) violate filename conventions.\n`);
process.stdout.write(`  Clean: ${ok.length}   Drift: ${drift.length}   Ungoverned: ${ungoverned.length}\n\n`);
for (const result of drift) {
  process.stdout.write(`  ${result.path}\n`);
  for (const convention of result.expectedConventions) {
    process.stdout.write(`    [${convention.id}] expected: ${convention.filenamePattern}\n`);
    process.stdout.write(`      good: ${convention.example}\n`);
    process.stdout.write(`      bad:  ${convention.counterexample}\n`);
  }
  process.stdout.write('\n');
}
process.stdout.write('See .claude/shared/naming-conventions.md for the full rule table.\n');
process.exit(1);
